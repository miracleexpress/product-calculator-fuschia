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

// —————————————————————————————————————————————
// Varyant Oluşturma ve Metafield Güncelleme Endpointi
// —————————————————————————————————————————————
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size' } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  try {
    // 1) Varyant oluşturma (inline args)
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;
    const productGid = `gid://shopify/Product/${productId}`;

    const variantMutation = `
      mutation {
        productVariantCreate(input: {
          productId: "${productGid}",
          price: "${price}",
          sku: "${sku}",
          options: ["${optionTitle}"],
          inventoryManagement: null,
          inventoryPolicy: CONTINUE
        }) {
          productVariant { id }
          userErrors { field message }
        }
      }
    `;

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: variantMutation },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const variantData = variantResponse.data?.data?.productVariantCreate;
    if (!variantData || variantData.userErrors.length) {
      console.error('❌ Variant creation error:', variantResponse.data);
      return res.status(500).json({ error: variantData?.userErrors || 'Variant creation failed' });
    }

    const variantId = variantData.productVariant.id;

    // 2) Metafield güncelleme (inline args)
    const metafieldMutation = `
      mutation {
        metafieldsSet(metafields: [
          {
            namespace: "prune",
            key: "isdeletable",
            ownerId: "${variantId}",
            type: "boolean",
            value: "true"
          }
        ]) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `;

    const mfResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: metafieldMutation },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const mfData = mfResponse.data?.data?.metafieldsSet;
    let isDeletable = false;
    if (mfData && !mfData.userErrors.length) {
      isDeletable = true;
    } else {
      console.warn('⚠️ Metafield update warnings/errors:', mfResponse.data);
    }

    // 3) Yanıt dön
    return res.status(200).json({ variantId, sku, isDeletable });

  } catch (err) {
    console.error('🚨 Server error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

// —————————————————————————————————————————————
// Sunucu Başlatma
// —————————————————————————————————————————————
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
