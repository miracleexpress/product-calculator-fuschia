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

// Örnek fiyat hesaplama fonksiyonu
function calculatePrice({ width, height, extras }) {
  const basePrice = 100;
  const areaMultiplier = (width * height) / 10000; // örnek: cm²'yi m²'ye çevir
  const extraCost = extras?.reduce((sum, x) => sum + (x.price || 0), 0);
  return (basePrice * areaMultiplier + extraCost).toFixed(2);
}

// Create Variant with GraphQL
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size', customProperties = {}, width, height, extras = [] } = req.body;

  if (!productId || !price || !width || !height) {
    return res.status(400).json({ error: 'productId, price, width, and height are required' });
  }

  // Güvenlik kontrolü: fiyatı backend tekrar hesaplasın
  const verifiedPrice = calculatePrice({ width, height, extras });
  if (parseFloat(price).toFixed(2) !== parseFloat(verifiedPrice).toFixed(2)) {
    return res.status(400).json({ error: 'Price mismatch - manipulation detected' });
  }

  try {
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;
    const productGid = `gid://shopify/Product/${productId}`;

    const mutation = `
      mutation {
        productVariantCreate(input: {
          productId: "${productGid}",
          price: "${verifiedPrice}",
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

    res.status(200).json({
      variantId: productVariant.id,
      variantTitle: productVariant.title,
      sku: productVariant.sku,
      verifiedPrice
    });

  } catch (err) {
    console.error('GraphQL variant creation error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
