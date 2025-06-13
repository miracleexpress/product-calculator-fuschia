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

const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// —————————————————————————————————————————————
// Shipping Profile alma
// —————————————————————————————————————————————
async function getShippingProfileId(productGid) {
  const query = `
    query {
      product(id: "${productGid}") {
        title
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
      { query },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    const result = res.data?.data?.product;
    console.log("📦 Shipping profile query result:", JSON.stringify(result, null, 2));
    return result?.shippingProfile?.id || null;
  } catch (err) {
    console.warn('⚠️ Shipping profile alınamadı:', err.message);
    return null;
  }

// —————————————————————————————————————————————
// Variant Oluşturma ve Kargo Profil Atama
// —————————————————————————————————————————————
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size' } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  try {
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;
    const productGid = `gid://shopify/Product/${productId}`;

    console.log("🧩 Varyant oluşturuluyor:", { productGid, price, sku, optionTitle });

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
    console.log("📦 Variant creation response:", JSON.stringify(gqlData, null, 2));

    const { productVariant, userErrors } = gqlData?.data?.productVariantCreate || {};

    if (userErrors?.length) {
      console.error('❌ Shopify userErrors:', userErrors);
      return res.status(400).json({ error: userErrors });
    }

    if (!productVariant?.id) {
      console.error('❌ Varyant oluşturulamadı.');
      return res.status(500).json({ error: 'Varyant oluşturulamadı' });
    }

    // Shipping profile eşlemesi
    const shippingProfileId = await getShippingProfileId(productGid);

    if (shippingProfileId) {
      const assignMutation = `
        mutation {
          deliveryProfilesUpdate(deliveryProfile: {
            id: "${shippingProfileId}"
            profileItems: [
              {
                variantId: "${productVariant.id}"
              }
            ]
          }) {
            deliveryProfile {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      console.log("📬 deliveryProfilesUpdate gönderiliyor:", {
        shippingProfileId,
        variantId: productVariant.id
      });

      const assignRes = await axios.post(
        `https://${shop}/admin/api/2023-10/graphql.json`,
        { query: assignMutation },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log("📬 deliveryProfilesUpdate yanıtı:", JSON.stringify(assignRes.data, null, 2));

      const assignErrors = assignRes.data?.data?.deliveryProfilesUpdate?.userErrors;
      if (assignErrors?.length) {
        console.warn('⚠️ deliveryProfilesUpdate hataları:', assignErrors);
      } else {
        console.log('✅ Varyant shipping profiline eklendi');
      }
    }

    res.status(200).json({
      variantId: productVariant.id,
      sku,
      isDeletable: true
    });
  } catch (err) {
    console.error('🔥 GraphQL error:', err.response?.data || err.message);
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
    // Eski varyantları çek
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
