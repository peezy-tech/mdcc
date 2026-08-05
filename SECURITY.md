# Security

Report vulnerabilities privately through GitHub's security advisory interface
for `peezy-tech/mdcc`. Do not include credentials, private instruction files, or
other sensitive context in a public issue.

`mdcc` reads only explicitly selected profile and snippet files. Profile snippet
names cannot escape the configured snippet directory. The compiler does not run
snippet content as code; `requires` and `excludes` only inspect executable names
on `PATH`.
