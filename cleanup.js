// cleanup.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;
const graphqlUrl = `https://${shop}/admin/api/2023-10/graphql.json`;
const headers = {
  'X-Shopify-Access-Token': accessToken,
  'Content-Type': 'application/json',
};

// Fetch all product IDs with pagination
async function fetchAllProductIDs() {
  let ids = [];
  let cursor = null;
  const query = `
    query($after: String) {
      products(first: 250, after: $after) {
        pageInfo { hasNextPage }
        edges { cursor node { id } }
      }
    }
  `;

  do {
    const variables = { after: cursor };
    const resp = await axios.post(graphqlUrl, { query, variables }, { headers });
    const body = resp.data;

    if (body.errors?.length) {
      console.error('🚨 GraphQL errors fetching products:', JSON.stringify(body.errors, null, 2));
      throw new Error('GraphQL errors on fetch products');
    }

    const productsData = body.data?.products;
    if (!productsData) {
      console.error('🚨 Unexpected response fetching products:', JSON.stringify(body, null, 2));
      throw new Error('Invalid products response');
    }

    for (const edge of productsData.edges) {
      ids.push(edge.node.id);
    }
    cursor = productsData.pageInfo.hasNextPage
      ? productsData.edges[productsData.edges.length - 1].cursor
      : null;
  } while (cursor);

  return ids;
}

// Fetch all variants for a given product ID with pagination
async function fetchAllVariants(productGid) {
  let variants = [];
  let cursor = null;
  const query = `
    query($id: ID!, $after: String) {
      node(id: $id) {
        ... on Product {
          variants(first: 250, after: $after) {
            pageInfo { hasNextPage }
            edges { cursor node { id title } }
          }
        }
      }
    }
  `;

  do {
    const variables = { id: productGid, after: cursor };
    const resp = await axios.post(graphqlUrl, { query, variables }, { headers });
    const body = resp.data;

    if (body.errors?.length) {
      console.error('🚨 GraphQL errors fetching variants:', JSON.stringify(body.errors, null, 2));
      throw new Error('GraphQL errors on fetch variants');
    }

    const variantsData = body.data?.node?.variants;
    if (!variantsData) {
      console.error('🚨 Unexpected response fetching variants:', JSON.stringify(body, null, 2));
      throw new Error('Invalid variants response');
    }

    for (const edge of variantsData.edges) {
      variants.push({ id: edge.node.id, title: edge.node.title });
    }
    cursor = variantsData.pageInfo.hasNextPage
      ? variantsData.edges[variantsData.edges.length - 1].cursor
      : null;
  } while (cursor);

  return variants;
}

async function cleanupVariants() {
  console.log('🧹 Starting full variant cleanup with pagination');
  try {
    const productIDs = await fetchAllProductIDs();

    for (const pid of productIDs) {
      const variants = await fetchAllVariants(pid);
      for (const { id, title } of variants) {
        if (/ - \d{4}$/.test(title)) {
          console.log(`🗑 Deleting ${id} — "${title}"`);

          const deleteMutation = `
            mutation {
              productVariantDelete(id: "${id}") {
                deletedProductVariantId
                userErrors { field message }
              }
            }
          `;

          let delResp;
          try {
            delResp = await axios.post(graphqlUrl, { query: deleteMutation }, { headers });
          } catch (networkErr) {
            console.error('🚨 Network error on delete:', networkErr.message);
            continue;
          }

          const body = delResp.data;
          if (body.errors?.length) {
            console.error('🚨 GraphQL errors on delete:', JSON.stringify(body.errors, null, 2));
            continue;
          }

          const result = body.data?.productVariantDelete;
          if (!result) {
            console.error('🚨 Unexpected delete response:', JSON.stringify(body, null, 2));
            continue;
          }

          if (result.userErrors.length) {
            console.error('❌ userErrors:', JSON.stringify(result.userErrors, null, 2));
          } else {
            console.log('✅ Deleted:', result.deletedProductVariantId);
          }
        }
      }
    }

    console.log('🧹 Variant cleanup complete');
  } catch (err) {
    console.error('🚨 Cleanup failed:', err.message);
  }
}

cleanupVariants();
