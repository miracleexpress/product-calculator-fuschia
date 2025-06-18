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
    // 1) Varyant oluşturma
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;
    const productGid = `gid://shopify/Product/${productId}`;

    const createVariantMutation = `
      mutation CreateVariant($input: ProductVariantCreateInput!) {
        productVariantCreate(input: $input) {
          productVariant { id }
          userErrors { field message }
        }
      }
    `;
    const createVariantVariables = {
      input: {
        productId: productGid,
        price: price.toString(),
        sku,
        options: [optionTitle],
        inventoryManagement: null,
        inventoryPolicy: 'CONTINUE'
      }
    };

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: createVariantMutation, variables: createVariantVariables },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const variantData = variantResponse.data?.data?.productVariantCreate;
    if (!variantData || variantData.userErrors.length) {
      console.error('❌ Variant creation error:', variantResponse.data);
      return res.status(500).json({ error: variantData?.userErrors || 'Variant creation failed' });
    }

    const variantId = variantData.productVariant.id;

    // 2) Metafield güncelleme (isDeletable=true)
    const metafieldMutation = `
      mutation SetMeta($input: MetafieldsSetInput!) {
        metafieldsSet(input: $input) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `;
    const metafieldVariables = {
      input: {
        metafields: [
          {
            namespace: 'prune',
            key: 'isdeletable',
            ownerId: variantId,
            type: 'boolean',
            value: 'true'
          }
        ]
      }
    };

    const mfResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { query: metafieldMutation, variables: metafieldVariables },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const mfData = mfResponse.data?.data?.metafieldsSet;
    let isDeletable = false;
    if (!mfData || mfData.userErrors.length) {
      console.warn('⚠️ Metafield update warnings/errors:', mfResponse.data);
    } else {
      isDeletable = true;
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
