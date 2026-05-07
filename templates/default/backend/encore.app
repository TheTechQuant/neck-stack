{
  "id": "__ENCORE_APP_CONFIG_ID__",
  "lang": "typescript",
  "build": {
    "worker_pooling": true
  },
  "global_cors": {
    "debug": false,
    "allow_headers": [
      "Authorization",
      "Content-Type",
      "X-Requested-With"
    ],
    "expose_headers": [
      "x-encore-trace-id"
    ],
    "allow_origins_with_credentials": [
      "https://__DOMAIN__",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ]
  }
}
