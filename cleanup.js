// cleanup.js
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const shop = process.env.SHOPIFY_SHOP
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY
const graphqlUrl = `https://${shop}/admin/api/2023-10/graphql.json`
const headers = {
  'X-Shopify-Access-Token': accessToken,
  'Content-Type': 'application/json',
}

// Helper: paginate through all products
async function fetchAllProductIDs() {
  let ids = []
  let cursor = null

  do {
    const query = `
      query($after: String) {
        products(first: 250${cursor ? ', after: $after' : ''}) {
          pageInfo { hasNextPage }
          edges { cursor node { id } }
        }
      }
    `
    const vars = cursor ? { after: cursor } : {}
    const resp = await axios.post(graphqlUrl, { query, variables: vars }, { headers })
    const data = resp.data.data.products

    for (const edge of data.edges) {
      ids.push(edge.node.id)
    }
    cursor = data.pageInfo.hasNextPage
      ? data.edges[data.edges.length - 1].cursor
      : null
  } while (cursor)

  return ids
}

// Helper: paginate through all variants of one product
async function fetchAllVariants(productGid) {
  let variants = []
  let cursor = null

  do {
    const query = `
      query($id: ID!, $after: String) {
        node(id: $id) {
          ... on Product {
            variants(first: 250${cursor ? ', after: $after' : ''}) {
              pageInfo { hasNextPage }
              edges { cursor node { id title } }
            }
          }
        }
      }
    `
    const vars = { id: productGid }
    if (cursor) vars.after = cursor
    const resp = await axios.post(graphqlUrl, { query, variables: vars }, { headers })
    const data = resp.data.data.node.variants

    for (const edge of data.edges) {
      variants.push({ id: edge.node.id, title: edge.node.title })
    }
    cursor = data.pageInfo.hasNextPage
      ? data.edges[data.edges.length - 1].cursor
      : null
  } while (cursor)

  return variants
}

async function cleanupVariants() {
  console.log('🧹 Starting full variant cleanup with pagination')
  try {
    const productIDs = await fetchAllProductIDs()

    for (const pid of productIDs) {
      const variants = await fetchAllVariants(pid)
      for (const { id, title } of variants) {
        if (/ - \d{4}$/.test(title)) {
          console.log(`🗑 Deleting ${id} — "${title}"`)

          const deleteMutation = `
            mutation {
              productVariantDelete(id: "${id}") {
                deletedProductVariantId
                userErrors { field message }
              }
            }
          `

          let delResp
          try {
            delResp = await axios.post(
              graphqlUrl,
              { query: deleteMutation },
              { headers }
            )
          } catch (networkErr) {
            console.error('🚨 Network error:', networkErr.message)
            continue
          }

          const body = delResp.data

          if (body.errors?.length) {
            console.error(
              '🚨 GraphQL errors:',
              JSON.stringify(body.errors, null, 2)
            )
            continue
          }

          const result = body.data?.productVariantDelete
          if (!result) {
            console.error(
              '🚨 Unexpected shape:',
              JSON.stringify(body, null, 2)
            )
            continue
          }

          if (result.userErrors.length) {
            console.error(
              '❌ userErrors:',
              JSON.stringify(result.userErrors, null, 2)
            )
          } else {
            console.log('✅ Deleted:', result.deletedProductVariantId)
          }
        }
      }
    }

    console.log('🧹 Variant cleanup complete')
  } catch (err) {
    console.error('🚨 Cleanup failed:', err.response?.data || err.message)
  }
}

cleanupVariants()
