# LLM Trace Insights - Oath

Final output: a deployed (or locally-runnable) stack.  A bipart dashboard, separated into operational and product-level concerns & reporting.

# Running it

- Open in your browser at: `https://oath.oliver-io.online`, or
- Follow instructions to: [run the app](./RUNNING.md)

# Samples 

# Development

A dev-log with my thoughts and process [can be read here](./DEV_LOG.md)
An llm-produced progress log with the actual meat can [be seen here](./docs/PROGRESS_LOG.md).

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
- Lots of cases where people are repeating the exact same operation, apparently, in a long-running session.  This likely resembles a sort of "batch-process" that could be automated for these folks, but they are likely logging in and re-executing this in Claude Code instead.  We could probably build a UI for these folks to configure a recurring or scheduled invocation of these operations, and remove the need to open up the same conversation and repeat.

### Summary

Lots of actionable information here but I would need to know more about the actual intent behind a lot of these conversations to know more.  Additionally I would need more human-details; are all auditors working with all clients?  If so, the AI usage is clustered on some clients.  Other such examples in the data.

# Conclusion

This is in a totally viable MVP category right now.  My next typical move would be to present this to stakeholders and ask what they are exicted by, or what bothers them.  Are there things that they expect to see missing?  Are pieces of the information shown useless, given the real concerns of the users?  Et cetera.  From the outside having nothing but the logs, some of these tools would need further explicated.

It took ~5 hours, I notated my progress [here](./DEV_LOG.md) for the curious.  A decent amount of this time was waiting for guided loops, data-bakes, et cetera.

# Notes

- Uses DuckDB and SQLite for data processing, parquet files for distribution
- Used AWS, Pulumi to deploy
- Uses `GPT-5.6-luna` to do enrichment determinations.  Weak model, but fast and cheap for an MVP.
- Data built and deployed locally.  For a real app, would automate its rebuild on a scheduled job or ETL pipeline.

# Work that I would do next

- I would want to improve the UI, load more data into it, and stress test it to see where we need to change architecture.
 - The widget UI looks bad, spacing and alignment wise, could make this look much better.
 - The whole site is lacking in some contrast.
- Add a lambda serving the time-sliced Parquet files from the backend, instead of just retrieving it.
- If this doesn't feel good with real quantities of data (totally depends on the real data quantities and the product intentions), move to an Elasticsearch architecture or shift the query compute to a cached backend instead of browser-side.
- I would want to spend more time manually validating some of the LLM-extracted determinations.  Would want to run on stronger models.
- I would want to learn more about the tool usage purpose and functionality.  It's hard to determine exactly what a failure consists of in some of these cases (is it a failure if we cannot find a document that does not exist?  etc.).
- I would want to implement CI here for automated deployments
- Spend some more time with the automated testing of the UI, for the future's sake
- Refactor and clean up
- Improve documentation
- A host of other things that don't occur to me at the moment.  Generally, this is the stage at which I would take this to someone who knows about the domain.  I've been sent this work without too much to go on; looking over the data, I can make lots of judgements but it isn't worth doing much work around them lest I waste some time.  Instead, I would take this to someone who works closely with the data and say: "Hey, check this out, is this useful?  If not, tell me why and I'll make it so."  At this point, I've laid the groundwork to easily adjust, add more data, or reformat the data extraction pipeline.