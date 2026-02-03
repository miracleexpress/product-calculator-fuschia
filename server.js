// server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Shopify Admin API Config
const shop = process.env.SHOPIFY_SHOP;                 // örn: wjais8-qu.myshopify.com
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY; // Admin API Access Token (write_products gerekli)

console.log('shop', shop);
console.log('accessToken', accessToken);

function assertEnv() {
  if (!shop || !accessToken) {
    throw new Error("SHOPIFY_SHOP veya SHOPIFY_ADMIN_API_KEY çevre değişkeni eksik.");
  }
}

// -----------------------------------------
// Health
// -----------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "API is running" });
});

// -----------------------------------------
// Create custom variant (REST Admin)
// -----------------------------------------
app.post("/create-custom-variant", async (req, res) => {
  try {
    assertEnv();
  } catch (e) {
    console.error(e.message);
    return res.status(500).json({ error: e.message });
  }

  const { productId, price, title = "Custom Size" } = req.body;

  if (!productId || price === undefined || price === null) {
    return res.status(400).json({ error: "productId and price are required" });
  }

  const productGid = `gid://shopify/Product/${productId}`;
  const customValue = `${title} - ${Date.now().toString().slice(-4)}`;
  const sku = `custom-${Date.now()}`;

  try {
    // 1) Ürünün option'larını oku (GraphQL)
    const PRODUCT_OPTIONS_QUERY = `
      query ProductOptions($id: ID!) {
        product(id: $id) {
          id
          options {
            name
            values
          }
        }
      }
    `;

    const prodResp = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: PRODUCT_OPTIONS_QUERY, variables: { id: productGid } },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const product = prodResp?.data?.data?.product;
    if (!product) {
      console.error("Product read error:", prodResp?.data);
      return res.status(500).json({ error: "Product could not be read.", debug: prodResp?.data });
    }

    const options = Array.isArray(product.options) ? product.options : [];

    // 2) REST Admin için option1/option2/option3 değerlerini sırayla hazırla
    //    - 1. option'a customValue yazıyoruz
    //    - kalan option'lara mevcut ilk değerlerini koyuyoruz
    //    - hiç option yoksa Shopify varsayılan 'Title' kabul eder; option1'e customValue veriyoruz
    const optionVals = [];
    if (options.length === 0) {
      optionVals.push(customValue);
    } else {
      options.forEach((opt, idx) => {
        if (idx === 0) {
          optionVals.push(customValue);
        } else {
          const firstVal =
            (Array.isArray(opt?.values) && opt.values.length > 0 && opt.values[0]) ||
            "Default Title";
          optionVals.push(firstVal);
        }
      });
    }

    const [option1, option2, option3] = [
      optionVals[0] || customValue,
      optionVals[1],
      optionVals[2],
    ];

    // 3) REST Admin ile varyant oluştur
    //    Not: inventory_policy: "continue" => stok 0 olsa da sat
    const variantPayload = {
      variant: {
        price: Number(price),          // sayısal gönderelim
        sku,
        option1,
        ...(option2 ? { option2 } : {}),
        ...(option3 ? { option3 } : {}),
        inventory_policy: "continue",
      },
    };

    const restResp = await axios.post(
      `https://${shop}/admin/api/2024-07/products/${productId}/variants.json`,
      variantPayload,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const v = restResp?.data?.variant;
    if (!v?.id) {
      console.error("Variant create (REST) response:", restResp?.data);
      return res.status(500).json({
        error: "Variant could not be created (REST).",
        debug: restResp?.data,
        selectedOptions: options.map((o, i) => ({
          name: o?.name || `Option${i + 1}`,
          value: optionVals[i],
        })),
      });
    }

    // 4) Numeric ID -> GID
    const variantId = `gid://shopify/ProductVariant/${v.id}`;
    return res.status(200).json({
      message: "Custom variant created successfully (REST).",
      variantId,
      sku,
      option: customValue,
      selectedOptions: options.map((o, i) => ({
        name: o?.name || `Option${i + 1}`,
        value: optionVals[i],
      })),
    });
  } catch (err) {
    console.error("Server error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: err.message,
      debug: err?.response?.data,
    });
  }
});

// -----------------------------------------
// Start
// -----------------------------------------
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
