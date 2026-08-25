# Contributing

Calendar is an external protoAgent plugin. Bug reports and focused contributions are welcome through GitHub Issues and pull requests.

Changes must:

1. preserve compatibility with an unmodified upstream protoAgent host;
2. use documented plugin contracts and public host APIs only;
3. avoid private core imports and core source changes;
4. include focused tests for any implemented behavior.

Run the Python and JavaScript checks documented in `README.md` before opening a pull request. Keep credentials, private calendar URLs, imported event data, and instance-specific paths out of issues, commits, and test fixtures.
