import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import {
    ReadResourceResultSchema,
    ListToolsResultSchema,
    CallToolResultSchema
} from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const DEBUG = true;
function debug(...args) {
    if (DEBUG) {
        console.error('[DEBUG]', ...args);
    }
}

process.on('uncaughtException', (error) => {
    debug('Uncaught exception:', error);
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    debug('Unhandled rejection at:', promise, 'reason:', reason);
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

class MCPClient {
    constructor() {
        // Map to store multiple server connections
        this.servers = new Map(); // key: serverPath, value: { session, transport }
        this.anthropic = new Anthropic();
        debug('MCPClient initialized');
    }

    async connectToServer(serverConfig) {
        debug('Connecting to server:', serverConfig);
        const { serverPath, args = [] } = typeof serverConfig === 'string' 
            ? { serverPath: serverConfig, args: [] }
            : serverConfig;

        // Check if server already exists
        if (this.servers.has(serverPath)) {
            debug('Server already registered:', serverPath);
            return { 
                status: 'error', 
                message: `Server ${serverPath} is already registered` 
            };
        }
        
        const isPython = serverPath.endsWith('.py');
        const isJs = serverPath.endsWith('.js');
        
        if (!isPython && !isJs) {
            debug('Invalid server script type:', serverPath);
            throw new Error("Server script must be a .py or .js file");
        }

        const command = isPython ? "python" : "node";
        debug('Using command:', command, 'with args:', [serverPath, ...args]);
        
        let transport;
        try {
            transport = new StdioClientTransport({
                command: command,
                args: [serverPath, ...args]
            });

            debug('Created transport, creating session...');
            const session = new Client({
                name: "mcp-client",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            debug('Connecting session...');
            await session.connect(transport);
            debug('Session connected successfully');
            
            this.servers.set(serverPath, { session, transport });
            debug('Server registered in map');
                return { 
                status: 'success', 
                message: `Successfully connected to server: ${serverPath}`,
                serverId: serverPath
            };
        } catch (error) {
            debug('Error connecting to server:', error);
            if (transport) {
                try {
                    await transport.close();
                } catch (closeError) {
                    debug('Error closing transport:', closeError);
                }
            }
            if (error.message.includes('ENOENT')) {
                throw new Error(`Server script not found: ${serverPath}`);
            }
            throw error;
        }
    }

    async processQuery(query, serverId) {
        const server = this.servers.get(serverId);
        if (!server) {
            throw new Error(`Server ${serverId} not found. Please register the server first.`);
        }

        try {
            // List available tools
            const toolsResponse = await server.session.request({ 
                method: "tools/list" 
            }, ListToolsResultSchema);

            console.log("Available tools:", toolsResponse.tools);

            // For Jira server, try to get issue details
            if (toolsResponse.tools.some(tool => tool.name === "jira_get_issue")) {
                const result = await server.session.request({
                    method: "tools/call",
                    params: {
                        name: "jira_get_issue",
                        arguments: {
                            issue_key: query
                        }
                    }
                }, CallToolResultSchema);
                return {
                    status: 'success',
                    query,
                    server: serverId,
                    result: result
                };
            }

            // Fallback to default resource reading
            const resourceContent = await server.session.request(
                {
                    method: "resources/read",
                    params: {
                        uri: "file:///example.txt"
                    }
                },
                ReadResourceResultSchema
            );

            return {
                status: 'success',
                query,
                server: serverId,
                resource: resourceContent.contents[0].text
            };
        } catch (error) {
            console.error("Error processing query:", error);
            throw error;
        }
    }

    async disconnectServer(serverId) {
        const server = this.servers.get(serverId);
        if (!server) {
            return {
                status: 'error',
                message: `Server ${serverId} not found`
            };
        }

        await server.transport.close();
        this.servers.delete(serverId);
        
        return {
            status: 'success',
            message: `Successfully disconnected server: ${serverId}`
        };
    }

    async cleanup() {
        // Cleanup all server connections
        for (const [serverId, server] of this.servers) {
            await server.transport.close();
        }
        this.servers.clear();
    }

    getStatus() {
        const serverStatus = {};
        for (const [serverId, server] of this.servers) {
            serverStatus[serverId] = {
                isConnected: !!server.session,
                path: serverId
            };
        }
        
        return {
            totalServers: this.servers.size,
            servers: serverStatus
        };
    }
}

// Create a singleton instance
const client = new MCPClient();

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Status endpoint
app.get('/status', (req, res) => {
    res.json(client.getStatus());
});

// Register server endpoint
app.post('/register', async (req, res) => {
    try {
        const { serverPath, args } = req.body;
        if (!serverPath) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverPath is required' 
            });
        }
        const result = await client.connectToServer({ serverPath, args });
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

// Disconnect server endpoint
app.post('/disconnect', async (req, res) => {
    try {
        const { serverId } = req.body;
        if (!serverId) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverId is required' 
            });
        }
        const result = await client.disconnectServer(serverId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

// Process query endpoint
app.post('/query', async (req, res) => {
    try {
        const { query, serverId } = req.body;
        if (!query) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'query is required' 
            });
        }
        if (!serverId) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverId is required' 
            });
        }
        const result = await client.processQuery(query, serverId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received. Cleaning up...');
    await client.cleanup();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT signal received. Cleaning up...');
    await client.cleanup();
    process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MCP Client Service running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  GET  /status              - Get current connection status');
    console.log('  POST /register            - Register a server (body: { "serverPath": "path/to/server.js" })');
    console.log('  POST /disconnect          - Disconnect a server (body: { "serverId": "server-path" })');
    console.log('  POST /query               - Process a query (body: { "serverId": "server-path", "query": "your query here" })');
});