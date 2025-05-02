// server.js
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Shopify Admin API Config
const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// Create Variant with GraphQL
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size', customProperties = {} } = req.body;

  try {
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;

    // Shopify GraphQL Product GID (convert if needed)
    const productGid = `gid://shopify/Product/${productId}`;

    const mutation = `
      mutation {
        productVariantCreate(input: {
          productId: "${productGid}",
          price: "${price}",
          sku: "${sku}",
          options: ["${optionTitle}"]
        }) {
          productVariant {
            id
            title
            sku
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const gqlRes = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: mutation },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const { productVariant, userErrors } = gqlRes.data.data.productVariantCreate;

    if (userErrors && userErrors.length > 0) {
      return res.status(400).json({ error: userErrors });
    }

    res.status(200).json({
      variantId: productVariant.id,
      variantTitle: productVariant.title,
      sku: productVariant.sku
    });

  } catch (err) {
    console.error('GraphQL variant creation error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
