# LLM Trace Insights - Oath

Final output: a deployed (or locally-runnable) stack.  A bipart dashboard, separated into operational and product-level concerns & reporting.

# Running it

- Open in your browser at: `https://oath.oliver-io.online`, or
- Follow instructions to: [run the app](./RUNNING.md)

# Discoveries

Every page on the webapp has relevant data to discuss.  A few actionable insights:

## Operations
- Tons of churn around the auth portal tool.  Regularly fails, and the document work falls back to manually driving the portal in a browser.  Unsure of exactly what this portal is supposed to do; presumably, retrieve credentials for certain document downloads and et cetera, but unclear why this wouldn't use the logged-in user's authentication token / oauth.
- 