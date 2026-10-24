# Deploy checklist: [service]

- [ ] Target branch, environment and Cloudflare account verified
- [ ] Latest commit and diff reviewed
- [ ] Wrangler config, route, runtime, bindings verified
- [ ] Secrets **names** present; values not exposed
- [ ] Migration impact and rollback/backup assessed
- [ ] Build + relevant tests performed or limitations recorded
- [ ] CI permissions and deployment concurrency checked
- [ ] Deploy explicitly within user's authorization and tool capabilities
- [ ] Actual deployment ID and health/smoke checks recorded
- [ ] Monitoring errors checked; rollback action documented
