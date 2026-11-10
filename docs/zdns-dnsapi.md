# ZDNS DNS API 用法

本仓库提供两个 acme.sh DNS 验证插件：`dns_zdns` 用于 ZDNS DDI，`dns_zdns_cloud` 用于 ZDNS Cloud。选择与域名权威 DNS 所在平台对应的插件。以下示例在本仓库目录运行；如果使用已安装的 acme.sh，可以将 `./acme.sh` 换成 `acme.sh`。

## ZDNS DDI (`dns_zdns`)

需要 ZDNS DDI API 地址、API 用户名和密码。该用户需要有目标视图和权威区域的记录管理权限；插件会查询匹配的权威区域，并添加、删除 ACME 验证所需的 TXT 记录。

```sh
export ZDNS_API_URL='https://zdns.example.com:20120'
export ZDNS_USERNAME='your-api-username'
export ZDNS_PASSWORD='your-api-password'
# 可选：默认视图为 default，TXT TTL 为 60 秒
export ZDNS_VIEW='default'
export ZDNS_TTL='60'

./acme.sh --issue --dns dns_zdns -d example.com -d '*.example.com'
```

`ZDNS_API_URL` 须包含 `http://` 或 `https://`，可带端口，不需要附加 API 路径。API 使用自签名证书时，可在签发命令中添加 acme.sh 的 `--insecure` 参数。

首次调用后，插件会把上述有效配置（包括密码）保存在 acme.sh 配置目录的 `account.conf` 中，通常是 `~/.acme.sh/account.conf`。后续签发或续期可以不再设置这些环境变量；环境变量存在时优先使用当前值。不要把该配置文件提交到 Git。

## ZDNS Cloud (`dns_zdns_cloud`)

此插件还需要 `node` 和 `curl`，并要求 `dnsapi/dns_zdns_cloud_client.mjs` 与 `dnsapi/dns_zdns_cloud.sh` 一起位于 acme.sh 的 `dnsapi/` 目录。`ZDNS_CLOUD_ZONE` 是域名所属的权威区域，不能填待验证的 `_acme-challenge` 主机名。

可用环境变量提供云平台账号：

```sh
export ZDNS_CLOUD_USERNAME='your-cloud-username'
export ZDNS_CLOUD_PASSWORD='your-cloud-password'
export ZDNS_CLOUD_ZONE='example.com.'
# 可选：TXT TTL 默认为 600 秒
export ZDNS_CLOUD_TTL='600'

./acme.sh --issue --dns dns_zdns_cloud -d example.com -d '*.example.com'
```

也可以将账号放在仓库外的凭据文件中，内容为 JSON，例如 `~/.config/zdns-cloud/credentials.json`：

```json
{"username":"your-cloud-username","password":"your-cloud-password"}
```

为文件设置仅本人可读权限（`chmod 600 ~/.config/zdns-cloud/credentials.json`）。默认会读取该路径；若使用其他路径，设置 `ZDNS_CLOUD_CREDENTIALS` 指向它。指定凭据文件时，文件优先于 `ZDNS_CLOUD_USERNAME` / `ZDNS_CLOUD_PASSWORD`。插件只把区域、TTL 和可选的凭据文件路径写入 acme.sh 的 `account.conf`，不会把云平台用户名和密码写入其中。登录令牌默认缓存于 `~/.cache/zdns-cloud/token.json`。

两个插件签发后都可用 acme.sh 正常续期，例如 `./acme.sh --renew -d example.com`；由 acme.sh 定时任务续期时，也要确保 Cloud 凭据文件可读，或在任务环境中提供 Cloud 账号变量。

## ZDNS Cloud 独立客户端

`dnsapi/dns_zdns_cloud_client.mjs` 也可直接管理 ZDNS Cloud 的 A、CNAME 和 TXT 记录。它使用与 Cloud 插件相同的凭据来源，所有命令都必须指定 `--zone`；区域末尾的点可以省略。`--host` 填区域内的相对主机名，根记录使用 `@`。默认视图为 `others`，默认新记录 TTL 为 600 秒。

```sh
# 列出区域内的记录，输出 JSON
node dnsapi/dns_zdns_cloud_client.mjs list --zone example.com

# 仅在相同主机、类型、视图和值的记录不存在时创建
node dnsapi/dns_zdns_cloud_client.mjs ensure --zone example.com \
  --host www --type A --value 192.0.2.10 --ttl 600

# 按记录 ID 更新或删除；ID 可从 list 的输出获取
node dnsapi/dns_zdns_cloud_client.mjs update --zone example.com \
  --id RECORD_ID --value 192.0.2.11
node dnsapi/dns_zdns_cloud_client.mjs delete --zone example.com --id RECORD_ID

# 按主机、类型、视图和值删除精确匹配的记录
node dnsapi/dns_zdns_cloud_client.mjs delete-matching --zone example.com \
  --host www --type A --value 192.0.2.10
```

其他命令包括 `create`（直接创建）和 `upsert`（有匹配的主机、类型、视图记录时更新，否则创建）。`create`、`ensure`、`upsert`、`delete-matching` 需要 `--host`、`--type`、`--value`；`update`、`delete` 需要 `--id`。`--view VIEW` 可指定视图，`--credentials FILE` 可指定凭据文件。修改命令可加 `--dry-run` 查看将执行的请求；它仍会登录并读取当前记录，但不会提交记录变更。
