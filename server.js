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
// Retry ile Shipping Profile Alma
// —————————————————————————————————————————————
async function getShippingProfileWithRetry(productGid, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    const getProfileQuery = `
      query {
        product(id: "${productGid}") {
          shippingProfile {
            id
            name
          }
        }
      }
    `;

    try {
      const res = await axios.post(
        `https://${shop}/admin/api/2023-10/graphql.json`,
        { query: getProfileQuery },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      const profileId = res.data?.data?.product?.shippingProfile?.id;
      if (profileId) return profileId;
    } catch (err) {
      console.warn("⚠️ Shipping profile çekim denemesi başarısız:", err.message);
    }

    // Bekle sonra tekrar dene
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return null;
}

// Create Variant with GraphQL
app.post('/create-custom-variant', async (req, res) => {
  let { productId, price, title = 'Custom Size', customProperties = {} } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  try {
    // Eğer gelen ID varyant ID'siyse, asıl productId'yi al
    if (productId.startsWith("gid://shopify/ProductVariant")) {
      const resolveQuery = `
        query {
          productVariant(id: "${productId}") {
            product {
              id
            }
          }
        }
      `;
      const resolveRes = await axios.post(
        `https://${shop}/admin/api/2023-10/graphql.json`,
        { query: resolveQuery },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      productId = resolveRes.data?.data?.productVariant?.product?.id?.split("gid://shopify/Product/")[1];
    }

    // Log ekle
    console.log("➡️ Gelen productId:", productId);
    const productGid = `gid://shopify/Product/${productId}`;
    console.log("➡️ productGid:", productGid);

    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;

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

    // ———————————— SHIPPING PROFILE ENTEGRASYONU ————————————

    const shippingProfileId = await getShippingProfileWithRetry(productGid);

    if (!shippingProfileId) {
      console.warn("⚠️ Shipping profile bulunamadı, taşıma yapılmayacak");
    } else {
      const moveMutation = `
        mutation {
          productMoveToShippingProfile(
            productId: "${productGid}",
            shippingProfileId: "${shippingProfileId}"
          ) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const moveRes = await axios.post(
        `https://${shop}/admin/api/2023-10/graphql.json`,
        { query: moveMutation },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      const moveErrors = moveRes.data?.data?.productMoveToShippingProfile?.userErrors;
      if (moveErrors && moveErrors.length > 0) {
        console.warn("⚠️ productMoveToShippingProfile hataları:", moveErrors);
      } else {
        console.log("✅ Ürün shipping profiline yeniden bağlandı");
      }
    }

    res.status(200).json({
      variantId : productVariant.id,
      sku,
      isDeletable: true
    });
  } catch (err) {
    console.error('GraphQL variant creation error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

/*
// —————————————————————————————————————————————
// PRUNE JOB: 24 saatten eski ve isDeletable=true metafield’ı olanları siler
// —————————————————————————————————————————————
async function deleteOldVariants() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let deletedCount = 0;
  let skippedCount = 0;

  try {
    const listRes = await axios.get(
      `https://${shop}/admin/api/2023-10/variants.json`,
      {
        params: { created_at_max: cutoff, limit: 250 },
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    const variants = listRes.data.variants || [];
    console.log(`Found ${variants.length} variants older than ${cutoff}`);

    for (const v of variants) {
      const mfRes = await axios.get(
        `https://${shop}/admin/api/2023-10/variants/${v.id}/metafields.json`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      const isDeletable = (mfRes.data.metafields || []).some(
        mf => mf.namespace === 'prune' && mf.key === 'isDeletable' && mf.value === 'true'
      );

      if (!isDeletable) {
        skippedCount++;
        console.log(`⏭️  Skipped non-deletable variant ${v.id}`);
        continue;
      }

      try {
        await axios.delete(
          `https://${shop}/admin/api/2023-10/variants/${v.id}.json`,
          { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        deletedCount++;
        console.log(`✅  Deleted variant ${v.id}`);
      } catch (delErr) {
        console.error(`❌  Failed to delete variant ${v.id}:`, delErr.response?.data || delErr.message);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`Prune complete: ${deletedCount} deleted, ${skippedCount} skipped.`);
  } catch (err) {
    console.error('Error during prune run:', err.response?.data || err.message);
  }
}
*/

/*
// Cron job: her gün 05:00’te çalıştır (Europe/Istanbul)
cron.schedule('0 5 * * *', () => {
  console.log(`[${new Date().toISOString()}] Starting prune job…`);
  deleteOldVariants();
}, { timezone: 'Europe/Istanbul' });
*/

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
