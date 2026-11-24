"use strict";

const csrfCookieName = "{{ csrf_cookie_name|default:'csrftoken'|escapejs }}";
const csrfHeaderName = "{{ csrf_header_name|escapejs }}";
const readCsrfCookie = () => {
  const prefix = csrfCookieName + '=';
  const csrfCookie = document.cookie.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));
  return csrfCookie?.slice(prefix.length);
};

SwaggerUIBundle({
  url: "{{ schema_url|escapejs }}",
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis],
  layout: "BaseLayout",
  persistAuthorization: false,
  requestInterceptor(request) {
    if (new URL(request.url, document.baseURI).origin !== window.location.origin) return request;
    request.credentials = "same-origin";
    if (request.method && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method.toUpperCase())) {
      // Login rotates csrftoken. Read the current cookie for each request.
      request.headers[csrfHeaderName] = readCsrfCookie() || "{{ csrf_token|escapejs }}";
    }
    return request;
  },
});
