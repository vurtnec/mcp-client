# MCP Client

## Overview
This is a Model Context Protocol (MCP) client project designed to facilitate advanced interactions with AI models and services.

## Prerequisites
- Node.js (version 16 or higher)
- pnpm (package manager)

## Installation
1. Clone the repository
```bash
git clone https://github.com/your-username/mcp-client.git
cd mcp-client
```

2. Install dependencies
```bash
pnpm install
```

## Configuration
1. Copy `mcp_config.json.example` to `mcp_config.json`
2. Modify the configuration file with your specific server and tool settings


## Usage

1. To run the client:
```bash
pnpm start
```

2. All your own servers will be registered when you run the client.

3. You can use the `list-tools` API to list all the tools available for a specific server.
```bash
curl --location 'http://localhost:3000/list-tools/{serverName}'
```
4. You can use the `call-tool` API to call a specific tool.
```bash
curl --location 'http://localhost:3000/call-tool' \
--header 'Content-Type: application/json' \
--data '{
    "serverName": "server_name",
    "toolName": "tool_name",
    "args": {
        // Arguments must match the inputSchema from the list-tools response
        // Required fields must be included
        // Optional fields can be omitted
        // Example based on above schema:
        // "issue_key": "PROJ-123"  // Required
        // "expand": "..."          // Optional
    }
}'
```

### Cursorrules

All tool calls will be logged in the `.cursorrules` file.

**IMPORTANT:** 
- YOU MUST COPY CURSORRULES TO YOUR OWN REPO AND EDIT IT TO YOUR OWN NEEDS.
- YOU MUST COPY "mcp_config.json" TO YOUR OWN REPO AND EDIT IT TO YOUR OWN NEEDS.

## Contributing
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License
Distributed under the MIT License. See `LICENSE` for more information.

## Contact
Your Name - your.email@example.com

Project Link: [https://github.com/your-username/mcp-client](https://github.com/your-username/mcp-client)