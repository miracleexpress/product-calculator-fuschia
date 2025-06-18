// server.js
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';

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

// —————————————————————————————————————————————
// Varyant Oluşturma Endpointi
// —————————————————————————————————————————————
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size', customProperties = {} } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  try {
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;

    const productGid = `gid://shopify/Product/${productId}`;

    const mutation = `
      mutation {
        productVariantCreate(input: {
          productId: "${productGid}",
          price: "${price}",
          sku: "${sku}",
          options: ["${optionTitle}"],
          inventoryManagement: null,
          inventoryPolicy: CONTINUE
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

    const gqlData = gqlRes?.data;

    if (!gqlData || !gqlData.data || !gqlData.data.productVariantCreate) {
      console.error('❌ Shopify yanıtı hatalı veya eksik:', JSON.stringify(gqlData, null, 2));
      return res.status(500).json({ error: 'Shopify yanıtı hatalı veya productVariantCreate eksik' });
    }

    const { productVariant, userErrors } = gqlData.data.productVariantCreate;

    if (userErrors && userErrors.length > 0) {
      console.error('❌ Shopify userErrors:', userErrors);
      return res.status(400).json({ error: userErrors });
    }

    if (!productVariant || !productVariant.id) {
      console.error('❌ Varyant oluşturulamadı, productVariant boş:', productVariant);
      return res.status(500).json({ error: 'Varyant oluşturulamadı, productVariant boş' });
    }

    // —————————————————————————————————————————————
    // Opsiyonel Metafield Eklemek için aktif blok
    // —————————————————————————————————————————————
    const mfMutation = `
      mutation {
        metafieldsSet(input: {
          metafields: [{
            namespace: "prune",
            key: "isdeletable",
            type: "boolean",
            value: "true",
            ownerId: "gid://shopify/ProductVariant/${productVariant.id}"
          }]
        }) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const mfRes = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: mfMutation },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const mfErrors = mfRes.data.data.metafieldsSet.userErrors;
    if (mfErrors && mfErrors.length) {
      console.warn('Metafield set warnings:', mfErrors);
    }

    res.status(200).json({
      variantId: productVariant.id,
      sku,
      isDeletable: true
    });
  } catch (err) {
    console.error('GraphQL variant creation error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// —————————————————————————————————————————————
// Sunucu Başlatma
// —————————————————————————————————————————————
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
