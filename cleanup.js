// cleanup.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;
const graphqlUrl = `https://${shop}/admin/api/2023-10/graphql.json`;
const headers = {
  'X-Shopify-Access-Token': accessToken,
  'Content-Type': 'application/json'
};

/**
 * Delete variants whose title ends with ' - ####' (4-digit suffix)
 */
async function cleanupVariants() {
  console.log('🧹 Starting variant cleanup');
  try {
    // 1) Tüm varyantları çekiyoruz
    const fetchQuery = `
      query {
        products(first: 250) {
          edges {
            node {
              variants(first: 250) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    `;
    const response = await axios.post(graphqlUrl, { query: fetchQuery }, { headers });
    const products = response.data.data.products.edges;

    for (const { node: product } of products) {
      for (const { node: variant } of product.variants.edges) {
        const { id, title } = variant;

        if (/ - \d{4}$/.test(title)) {
          console.log(`🗑 Deleting variant ${id} — '${title}'`);

          // 2) Silme mutasyonu (API 2023-10: doğrudan id argümanı)
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

          // 3) GraphQL-level hataları varsa logla
          if (body.errors && body.errors.length) {
            console.error('🚨 GraphQL errors on delete:', JSON.stringify(body.errors, null, 2));
            continue;
          }

          // 4) data.productVariantDelete mutlaka gelsin diye kontrol et
          const result = body.data?.productVariantDelete;
          if (!result) {
            console.error('🚨 Unexpected delete response shape:', JSON.stringify(body, null, 2));
            continue;
          }

          // 5) userErrors kontrolü
          if (result.userErrors.length) {
            console.error('❌ Shopify userErrors:', JSON.stringify(result.userErrors, null, 2));
          } else {
            console.log('✅ Deleted:', result.deletedProductVariantId);
          }
        }
      }
    }

    console.log('🧹 Variant cleanup finished');
  } catch (err) {
    console.error('🚨 Cleanup job failed:', err.response?.data || err.message);
  }
}

cleanupVariants();
