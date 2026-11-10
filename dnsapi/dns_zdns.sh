#!/usr/bin/env sh

# shellcheck disable=SC2034
dns_zdns_info='ZDNS DDI
Site: https://www.zdns.cn/
Docs: github.com/acmesh-official/acme.sh/wiki/dnsapi2#dns_zdns
Options:
 ZDNS_API_URL API URL, including scheme and optional port. E.g. "https://zdns.example.com:20120".
 ZDNS_USERNAME API username.
 ZDNS_PASSWORD API password.
 ZDNS_VIEW DNS view name. Default: "default".
 ZDNS_TTL TXT record TTL. Default: "60".
Use acme.sh --insecure when the ZDNS API uses a self-signed certificate.
'

ZDNS_DEFAULT_VIEW="default"
ZDNS_DEFAULT_TTL="60"

######## Public functions ####################

# Usage: dns_zdns_add _acme-challenge.www.example.com "challenge-value"
dns_zdns_add() {
  fulldomain=$1
  txtvalue=$2

  if ! _zdns_load_config; then
    return 1
  fi

  if ! _zdns_get_root "$fulldomain"; then
    _err "Unable to find the authoritative ZDNS zone for $fulldomain."
    return 1
  fi

  _debug _domain "$_domain"
  _debug _sub_domain "$_sub_domain"

  _zdns_name=$(_zdns_json_escape "$_sub_domain")
  _zdns_value=$(_zdns_json_escape "$txtvalue")
  _zdns_user=$(_zdns_json_escape "$ZDNS_USERNAME")
  _zdns_data="{\"name\":\"$_zdns_name\",\"type\":\"TXT\",\"ttl\":\"$ZDNS_TTL\",\"rdata\":\"$_zdns_value\",\"is_enable\":\"yes\",\"expire_is_enable\":\"no\",\"current_user\":\"$_zdns_user\"}"

  _info "Adding TXT record for $fulldomain"
  if ! _zdns_rest "POST" "/views/$_zdns_view/zones/$_zdns_zone/rrs" "$_zdns_data"; then
    _err "Failed to add the ZDNS TXT record."
    return 1
  fi

  _zdns_normalized=$(printf "%s" "$response" | _normalizeJson)
  if ! _contains "$_zdns_normalized" '"type":"TXT"'; then
    _err "ZDNS returned an unexpected response while adding the TXT record."
    _debug2 response "$response"
    return 1
  fi

  return 0
}

# Usage: dns_zdns_rm _acme-challenge.www.example.com "challenge-value"
dns_zdns_rm() {
  fulldomain=$1
  txtvalue=$2

  if ! _zdns_load_config; then
    return 1
  fi

  if ! _zdns_get_root "$fulldomain"; then
    _err "Unable to find the authoritative ZDNS zone for $fulldomain."
    return 1
  fi

  _debug _domain "$_domain"

  _zdns_fqdn="${fulldomain%.}."
  _zdns_extend_id="$_zdns_fqdn\$TXT\$$txtvalue"
  _zdns_extend_id=$(_zdns_json_escape "$_zdns_extend_id")
  _zdns_user=$(_zdns_json_escape "$ZDNS_USERNAME")
  _zdns_data="{\"extend_ids\":[\"$_zdns_extend_id\"],\"current_user\":\"$_zdns_user\"}"

  _info "Removing TXT record for $fulldomain"
  if ! _zdns_rest "DELETE" "/views/$_zdns_view/zones/$_zdns_zone/rrs" "$_zdns_data"; then
    _err "Failed to remove the ZDNS TXT record."
    return 1
  fi

  _zdns_normalized=$(printf "%s" "$response" | _normalizeJson)
  if ! _contains "$_zdns_normalized" '"result":"succeed"'; then
    _err "ZDNS returned an unexpected response while removing the TXT record."
    _debug2 response "$response"
    return 1
  fi

  return 0
}

######## Private functions below ####################

_zdns_load_config() {
  ZDNS_API_URL="${ZDNS_API_URL:-$(_readaccountconf_mutable ZDNS_API_URL)}"
  ZDNS_USERNAME="${ZDNS_USERNAME:-$(_readaccountconf_mutable ZDNS_USERNAME)}"
  ZDNS_PASSWORD="${ZDNS_PASSWORD:-$(_readaccountconf_mutable ZDNS_PASSWORD)}"
  ZDNS_VIEW="${ZDNS_VIEW:-$(_readaccountconf_mutable ZDNS_VIEW)}"
  ZDNS_TTL="${ZDNS_TTL:-$(_readaccountconf_mutable ZDNS_TTL)}"

  if [ -z "$ZDNS_API_URL" ] || [ -z "$ZDNS_USERNAME" ] || [ -z "$ZDNS_PASSWORD" ]; then
    _err "ZDNS_API_URL, ZDNS_USERNAME and ZDNS_PASSWORD must be set."
    return 1
  fi

  ZDNS_VIEW="${ZDNS_VIEW:-$ZDNS_DEFAULT_VIEW}"
  ZDNS_TTL="${ZDNS_TTL:-$ZDNS_DEFAULT_TTL}"

  case "$ZDNS_TTL" in
  "" | *[!0-9]*)
    _err "ZDNS_TTL must be a positive integer."
    return 1
    ;;
  esac

  if [ "$ZDNS_TTL" -le 0 ]; then
    _err "ZDNS_TTL must be a positive integer."
    return 1
  fi

  ZDNS_API_URL="${ZDNS_API_URL%/}"
  _zdns_view=$(printf "%s" "$ZDNS_VIEW" | _url_encode)

  _saveaccountconf_mutable ZDNS_API_URL "$ZDNS_API_URL"
  _saveaccountconf_mutable ZDNS_USERNAME "$ZDNS_USERNAME"
  _saveaccountconf_mutable ZDNS_PASSWORD "$ZDNS_PASSWORD"
  _saveaccountconf_mutable ZDNS_VIEW "$ZDNS_VIEW"
  _saveaccountconf_mutable ZDNS_TTL "$ZDNS_TTL"

  return 0
}

# Sets _domain, _sub_domain, and the encoded _zdns_zone.
_zdns_get_root() {
  domain="${1%.}"
  i=1
  p=1

  while true; do
    h=$(printf "%s" "$domain" | cut -d . -f "$i"-100)
    if [ -z "$h" ]; then
      return 1
    fi

    _debug "Probing ZDNS zone" "$h"
    _zdns_candidate=$(_zdns_json_escape "$h")
    _zdns_user=$(_zdns_json_escape "$ZDNS_USERNAME")
    _zdns_page=1

    while true; do
      _zdns_data="{\"page_size\":30,\"page_num\":$_zdns_page,\"search_attrs\":{\"name\":\"$_zdns_candidate\"},\"current_user\":\"$_zdns_user\"}"

      if ! _zdns_rest "GET" "/views/$_zdns_view/zones" "$_zdns_data"; then
        return 1
      fi

      _zdns_zones=$(printf "%s" "$response" | _normalizeJson)
      if _contains "$_zdns_zones" "\"name\":\"$_zdns_candidate\""; then
        _domain=$h
        if [ "$domain" = "$h" ]; then
          _sub_domain="@"
        else
          _sub_domain=$(printf "%s" "$domain" | cut -d . -f 1-"$p")
        fi
        _zdns_zone=$(printf "%s" "$_domain" | _url_encode)
        return 0
      fi

      _zdns_total=$(printf "%s" "$_zdns_zones" | sed -n 's/.*"total_size":"\{0,1\}\([0-9][0-9]*\).*/\1/p')
      _zdns_page_end=$(_math "$_zdns_page" \* 30)
      if [ -z "$_zdns_total" ] || [ "$_zdns_total" -le "$_zdns_page_end" ]; then
        break
      fi
      _zdns_page=$(_math "$_zdns_page" + 1)
    done

    p=$i
    i=$(_math "$i" + 1)
  done
}

_zdns_rest() {
  method=$1
  endpoint=$2
  data=$3

  _zdns_auth=$(printf "%s" "$ZDNS_USERNAME:$ZDNS_PASSWORD" | _base64)
  export _H1="Authorization: Basic $_zdns_auth"

  response="$(_post "$data" "$ZDNS_API_URL$endpoint" "" "$method" "application/json")"
  _zdns_ret=$?
  unset _H1

  if [ "$_zdns_ret" != "0" ]; then
    _err "ZDNS API request failed: $method $endpoint"
    return 1
  fi

  _debug2 response "$response"
  _zdns_normalized=$(printf "%s" "$response" | _normalizeJson)
  if _contains "$_zdns_normalized" '"error":'; then
    _err "ZDNS API returned an error: $response"
    return 1
  fi

  return 0
}

_zdns_json_escape() {
  printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}
