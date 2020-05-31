import { Router } from 'service-worker-router';
import { getAsset } from '@cinematix/next-cloudflare';
import {
  routesManifest, MIME_TYPES, getResponseDataJson, getResourceMetadata,
} from '@chickaree/web';
import getResource from './resource';

// Instantiate a new router for sub requests.
const router = new Router();

router.get('/:domain/:hash', getResource);
router.get('/:domain', getResource);

async function nextHandler({ event, request, url }) {
  const asset = await getAsset(event, routesManifest);

  if (asset.headers.has('Content-Location')) {
    const location = new URL(asset.headers.get('Content-Location'), url);

    if (location.pathname === '/[...resource].html') {
      // @TODO implement stale-on-revalidate on production.

      const { handlerPromise } = router.handleRequest(request);
      const response = await handlerPromise;

      if (response.headers.has('Location')) {
        return response;
      }

      if (!response.ok) {
        return asset;
      }

      if (!response.headers.has('Content-Type')) {
        return asset;
      }

      const mimeType = response.headers.get('Content-Type').split(';').shift().trim();

      if (!MIME_TYPES.includes(mimeType)) {
        return asset;
      }

      let data;
      if (mimeType === 'application/json') {
        data = await getResponseDataJson(response.headers.get('Content-Location'), await response.json());
      } else {
        let resourceResponse;

        // Remove the body from the HTML page.
        if (mimeType === 'text/html') {
          // eslint-disable-next-line no-undef
          resourceResponse = (new HTMLRewriter()).on('body', {
            element(element) {
              element.setInnerContent('');
            },
          }).transform(response);
        } else {
          resourceResponse = response;
        }

        const parseURL = new URL(`/api/parse${url.pathname}`, url);

        const parsedResponse = await fetch(parseURL.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': resourceResponse.headers.get('Content-Type'),
          },
          body: resourceResponse.body,
        });

        if (!parsedResponse.ok) {
          // @TODO Log this somehow?
          return asset;
        }

        data = await parsedResponse.json();
      }

      if (!data) {
        return asset;
      }

      const { title, og, schema } = getResourceMetadata(data);

      // eslint-disable-next-line no-undef
      return (new HTMLRewriter()).on('head', {
        element(element) {
          // @TODO Maybe a data-route attribute should be added... then the next app could listen
          //       for route changes query for all `head script[data-route]` elements. If the route
          //       no longer matches, it could remove the element if it does still match it will
          //       leave it, an id (or maybe data-prop ?) will indicate the property name. to pass
          //       as a page prop. this assumes that the custom app _already_ renders on route
          //       change (I assume it does...)
          element.append(`<script id="resource" type="application/activity+json" data-pathname="${url.pathname}">${JSON.stringify(data)}</script>`, {
            html: true,
          });
        },
      })
        .on('script[type="application/ld+json"]', {
          element(element) {
            element.setInnerContent(JSON.stringify(schema));
          },
        })
        .on('title', {
          element(element) {
            if (title) {
              element.setInnerContent(title);
            }
          },
        })
        .on('meta[property="og:title"]', {
          element(element) {
            if (og.title) {
              element.setAttribute('content', og.title);
            }
          },
        })
        .on('meta[property="og:description"]', {
          element(element) {
            if (og.description) {
              element.setAttribute('content', og.description);
            }
          },
        })
        .on('meta[property="og:image"]', {
          element(element) {
            if (og.image) {
              element.setAttribute('content', og.image);
            }
          },
        })
        .on('meta[property="og:type"]', {
          element(element) {
            if (og.type) {
              element.setAttribute('content', og.type);
            }
          },
        })
        .on('meta[property="og:url"]', {
          element(element) {
            if (og.url) {
              element.setAttribute('content', og.url);
            }
          },
        })
        .transform(asset);
    }
  }

  return asset;
}

export default nextHandler;
