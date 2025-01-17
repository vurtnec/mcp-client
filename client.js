import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
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
        this.servers = new Map(); // key: serverName, value: { session, transport }
        this.anthropic = new Anthropic();
        this.config = null;
        debug('MCPClient initialized');
    }

    async loadConfig() {
        try {
            const configPath = path.join(process.cwd(), 'mcp_config.json');
            const configData = await fs.promises.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
            debug('Loaded config:', this.config);
            return this.config;
        } catch (error) {
            debug('Error loading config:', error);
            throw new Error(`Failed to load mcp_config.json: ${error.message}`);
        }
    }

    async connectToServer(serverConfig) {
        debug('Connecting to server:', serverConfig);
        const { serverName, command = 'npx', args = [], env = {} } = serverConfig;

        // Check if server already exists
        if (this.servers.has(serverName)) {
            debug('Server already registered:', serverName);
            return { 
                status: 'error', 
                message: `Server ${serverName} is already registered` 
            };
        }

        const fullEnv = {
            ...process.env, 
            ...env 
        };
        
        console.log('env', env);
        let transport;
        try {
            transport = new StdioClientTransport({
                command,
                args,
                env: fullEnv
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
            
            this.servers.set(serverName, { session, transport });
            debug('Server registered in map');
            return { 
                status: 'success', 
                message: `Successfully connected to server: ${serverName}`,
                serverId: serverName
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
            throw error;
        }
    }

    async registerAllServers() {
        if (!this.config) {
            await this.loadConfig();
        }

        const results = [];
        for (const [serverName, serverConfig] of Object.entries(this.config.mcpServers)) {
            try {
                const result = await this.connectToServer({
                    serverName,
                    command: serverConfig.command,
                    args: serverConfig.args,
                    env: serverConfig.env
                });
                results.push(result);
            } catch (error) {
                debug(`Error registering server ${serverName}:`, error);
                results.push({
                    status: 'error',
                    message: `Failed to register ${serverName}: ${error.message}`,
                    serverId: serverName
                });
            }
        }
        return results;
    }

    async processToolCall(toolName, args, serverName) {
        const server = this.servers.get(serverName);
        if (!server) {
            throw new Error(`Server ${serverName} not found. Please register the server first.`);
        }

        try {
            // List available tools
            const toolsResponse = await server.session.request({ 
                method: "tools/list" 
            }, ListToolsResultSchema);

            debug("Available tools:", toolsResponse.tools);

            // Check if the requested tool exists
            const tool = toolsResponse.tools.find(t => t.name === toolName);
            if (!tool) {
                throw new Error(`Tool ${toolName} not found in server ${serverName}. Available tools: ${toolsResponse.tools.map(t => t.name).join(', ')}`);
            }

            // Call the tool
            const result = await server.session.request({
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: args
                }
            }, CallToolResultSchema);

            return {
                status: 'success',
                tool: toolName,
                server: serverName,
                result: result
            };
        } catch (error) {
            debug("Error processing tool call:", error);
            throw error;
        }
    }

    async disconnectServer(serverName) {
        const server = this.servers.get(serverName);
        if (!server) {
            return {
                status: 'error',
                message: `Server ${serverName} not found`
            };
        }

        try {
            await server.transport.close();
            this.servers.delete(serverName);
            
            return {
                status: 'success',
                message: `Successfully disconnected server: ${serverName}`
            };
        } catch (error) {
            debug("Error disconnecting server:", error);
            throw error;
        }
    }

    async cleanup() {
        const results = [];
        // Cleanup all server connections
        for (const [serverName, server] of this.servers) {
            try {
                await server.transport.close();
                results.push({
                    status: 'success',
                    message: `Successfully disconnected server: ${serverName}`,
                    serverName
                });
            } catch (error) {
                debug(`Error disconnecting server ${serverName}:`, error);
                results.push({
                    status: 'error',
                    message: `Failed to disconnect ${serverName}: ${error.message}`,
                    serverName
                });
            }
        }
        this.servers.clear();
        return results;
    }

    getStatus() {
        const serverStatus = {};
        for (const [serverName, server] of this.servers) {
            serverStatus[serverName] = {
                isConnected: !!server.session,
                name: serverName
            };
        }
        
        return {
            totalServers: this.servers.size,
            servers: serverStatus
        };
    }

    async listTools(serverName) {
        const server = this.servers.get(serverName);
        if (!server) {
            throw new Error(`Server ${serverName} not found. Please register the server first.`);
        }

        try {
            const toolsResponse = await server.session.request({ 
                method: "tools/list" 
            }, ListToolsResultSchema);

            return {
                status: 'success',
                server: serverName,
                tools: toolsResponse.tools
            };
        } catch (error) {
            debug("Error listing tools:", error);
            throw error;
        }
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
        const { serverName } = req.body;
        if (!serverName) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverName is required' 
            });
        }

        // Load config if not loaded
        if (!client.config) {
            await client.loadConfig();
        }

        const serverConfig = client.config.mcpServers[serverName];
        if (!serverConfig) {
            return res.status(400).json({
                status: 'error',
                message: `Server ${serverName} not found in config`
            });
        }

        const result = await client.connectToServer({ 
            serverName,
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env
        });
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
        const { serverName } = req.body;
        if (!serverName) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverName is required' 
            });
        }
        const result = await client.disconnectServer(serverName);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

// Process query endpoint
app.post('/call-tool', async (req, res) => {
    try {
        const { toolName, args, serverName } = req.body;
        if (!toolName) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'toolName is required' 
            });
        }
        if (!serverName) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverName is required' 
            });
        }
        if (!args) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'args is required' 
            });
        }
        const result = await client.processToolCall(toolName, args, serverName);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

// List tools endpoint
app.get('/list-tools/:serverName', async (req, res) => {
    try {
        const { serverName } = req.params;
        if (!serverName) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'serverName is required' 
            });
        }
        const result = await client.listTools(serverName);
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
app.listen(PORT, async () => {
    console.log(`MCP Client Service running on http://localhost:${PORT}`);
    
    // Auto-register all servers from config
    try {
        await client.loadConfig();
        const results = await client.registerAllServers();
        console.log('Auto-registration results:', results);
    } catch (error) {
        console.error('Error during auto-registration:', error);
    }

    console.log('Available endpoints:');
    console.log('  GET  /status              - Get current connection status');
    console.log('  GET  /list-tools/:serverName - List available tools for a server');
    console.log('  POST /register            - Register a server (body: { "serverName": "server-name-from-config" })');
    console.log('  POST /disconnect          - Disconnect a server (body: { "serverName": "server-name" })');
    console.log('  POST /call-tool           - Process a tool call (body: { "serverName": "server-name", "toolName": "tool-name", "args": "tool-args" })');
});