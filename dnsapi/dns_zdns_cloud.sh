#!/usr/bin/env sh

# shellcheck disable=SC2034
dns_zdns_cloud_info='ZDNS Cloud DNS
Site: https://dns.yun.zdns.cn/
Options:
 ZDNS_CLOUD_ZONE Authoritative zone, e.g. web-dev.zdns.cn.
 ZDNS_CLOUD_CREDENTIALS Optional credentials file path.
 ZDNS_CLOUD_TTL TXT TTL, default 600.
Requires Node.js and curl. The bundled client is dnsapi/dns_zdns_cloud_client.mjs.
'

dns_zdns_cloud_add() {
  _zdns_cloud_fulldomain=$1
  _zdns_cloud_txtvalue=$2
  _zdns_cloud_prepare "$_zdns_cloud_fulldomain" || return 1

  _info "Adding ZDNS Cloud TXT record for $_zdns_cloud_fulldomain"
  if ! _zdns_cloud_run ensure --zone "$ZDNS_CLOUD_ZONE" --host "$_zdns_cloud_host" \
    --type TXT --value "$_zdns_cloud_txtvalue" --ttl "$ZDNS_CLOUD_TTL" >/dev/null; then
    _err "Failed to add ZDNS Cloud TXT record for $_zdns_cloud_fulldomain"
    return 1
  fi
}

dns_zdns_cloud_rm() {
  _zdns_cloud_fulldomain=$1
  _zdns_cloud_txtvalue=$2
  _zdns_cloud_prepare "$_zdns_cloud_fulldomain" || return 1

  _info "Removing ZDNS Cloud TXT record for $_zdns_cloud_fulldomain"
  if ! _zdns_cloud_run delete-matching --zone "$ZDNS_CLOUD_ZONE" --host "$_zdns_cloud_host" \
    --type TXT --value "$_zdns_cloud_txtvalue" >/dev/null; then
    _err "Failed to remove ZDNS Cloud TXT record for $_zdns_cloud_fulldomain"
    return 1
  fi
}

_zdns_cloud_prepare() {
  ZDNS_CLOUD_ZONE="${ZDNS_CLOUD_ZONE:-$(_readaccountconf_mutable ZDNS_CLOUD_ZONE)}"
  ZDNS_CLOUD_CREDENTIALS="${ZDNS_CLOUD_CREDENTIALS:-$(_readaccountconf_mutable ZDNS_CLOUD_CREDENTIALS)}"
  ZDNS_CLOUD_TTL="${ZDNS_CLOUD_TTL:-$(_readaccountconf_mutable ZDNS_CLOUD_TTL)}"
  ZDNS_CLOUD_TTL="${ZDNS_CLOUD_TTL:-600}"
  _zdns_cloud_client="$_SCRIPT_HOME/dnsapi/dns_zdns_cloud_client.mjs"

  if [ -z "$ZDNS_CLOUD_ZONE" ] || [ ! -f "$_zdns_cloud_client" ] || ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    _err "Set ZDNS_CLOUD_ZONE and install dns_zdns_cloud_client.mjs in acme.sh dnsapi/; Node.js and curl are required."
    return 1
  fi
  case "$ZDNS_CLOUD_TTL" in
    '' | *[!0-9]*) _err "ZDNS_CLOUD_TTL must be a positive integer."; return 1 ;;
  esac
  if [ "$ZDNS_CLOUD_TTL" -le 0 ]; then
    _err "ZDNS_CLOUD_TTL must be a positive integer."
    return 1
  fi

  _zdns_cloud_zone=${ZDNS_CLOUD_ZONE%.}
  _zdns_cloud_name=${1%.}
  case "$_zdns_cloud_name" in
    "$_zdns_cloud_zone") _zdns_cloud_host=@ ;;
    *."$_zdns_cloud_zone") _zdns_cloud_host=${_zdns_cloud_name%."$_zdns_cloud_zone"} ;;
    *) _err "$_zdns_cloud_name is outside ZDNS_CLOUD_ZONE=$_zdns_cloud_zone"; return 1 ;;
  esac
  ZDNS_CLOUD_ZONE="$_zdns_cloud_zone."

  _saveaccountconf_mutable ZDNS_CLOUD_ZONE "$ZDNS_CLOUD_ZONE"
  _saveaccountconf_mutable ZDNS_CLOUD_TTL "$ZDNS_CLOUD_TTL"
  if [ -n "$ZDNS_CLOUD_CREDENTIALS" ]; then
    _saveaccountconf_mutable ZDNS_CLOUD_CREDENTIALS "$ZDNS_CLOUD_CREDENTIALS"
  fi
}

_zdns_cloud_run() {
  if [ -n "$ZDNS_CLOUD_CREDENTIALS" ]; then
    node "$_zdns_cloud_client" "$@" --credentials "$ZDNS_CLOUD_CREDENTIALS"
  else
    node "$_zdns_cloud_client" "$@"
  fi
}
