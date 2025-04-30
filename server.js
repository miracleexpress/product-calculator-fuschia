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

// Shopify Admin API Base Config
const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size', customProperties = {} } = req.body;

  try {
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
  
    const variantRes = await axios.post(
      `https://${shop}/admin/api/2023-10/products/${productId}/variants.json`,
      {
        variant: {
          option1: optionTitle,
          price: price.toString(),
          sku: `custom-${Date.now()}`,
          inventory_management: null
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
  
    const variant = variantRes.data.variant;
  
    res.status(200).json({
      variantId: variant.id,
      variantTitle: variant.option1
    });
  
  } catch (err) {
    console.error('Error creating variant:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
  
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});