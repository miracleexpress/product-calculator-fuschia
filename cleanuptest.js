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
 * Log variants whose title ends with ' - ####' (4-digit suffix)
 */
async function cleanupVariants() {
  console.log('🧹 Starting variant cleanup (logging only)');
  try {
    // Fetch all variants with their titles
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
        // If variant title ends with ' - ####', log it
        if (/ - \d{4}$/.test(title)) {
          console.log(`📌 Matched variant ${id} with title '${title}'`);
        }
      }
    }

    console.log('🧹 Variant cleanup logging complete');
  } catch (error) {
    console.error('🚨 Cleanup job failed', error.response?.data || error.message);
  }
}

cleanupVariants();
