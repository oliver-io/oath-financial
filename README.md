# LLM Trace Insights - Oath

Final output: a deployed (or locally-runnable) stack.  A bipart dashboard, separated into operational and product-level concerns & reporting.

# Running it

- Open in your browser at: `https://oath.oliver-io.online`, or
- Follow instructions to: [run the app](./RUNNING.md)

# Discoveries

Every page on the webapp has relevant data to discuss.  A few actionable insights:

## Operations
- We can see tool failures of what appear to be an environmental/dependency problem: `bash: line 1: marut: command not found
bash: line 1: search: command not found
bash: line 1: carta: command not found`, etc.
- Sometimes we see some file calls that look a bit suspicious: `grep: /srv/audit/corpus/78387a38-8170-1882-0829-5b427a9af20a/Capital_Call_Notice.pdf.txt: No such file or directory`, would look more into this.
- Churn around the authentication state, we may be able to write code around this that simply automatically prompts the user to re-authenticate.
- Decent numbers of other issues: `carta: portal returned HTTP 403: connector is not configured for this client.`, etc.
- `Harborline`-tenant-relevant requests have a higher failure rate than other tenant-work.  Could be random or worth a look.
- Failure spikes in the most recent data.  Maybe worth looking at?

### Summary

Some of these issues presented in the UI are alright (agent code that crashed) but some definitely a failure on the env/infrastructure of the agent.  Can be fixed up.  Some of the auth errors are just stale sessions etc.

## Product

- Usage trends on a general upward bent over time
- `Vestmar` work seems universally adopted with this system but otherwise not so much
- `doc_location`, and `doc_receipt_check` tied for most popular job type -- possibly interesting?
-  `tie_out`, `drafting`, and `doc_inventory` follow up
- `other`/`extraction_supervision` appear, might be worth a look for why there are the former at all and low usage for the latter
- Certain tasks like `capability_probe` have an unusually high abandonment rate