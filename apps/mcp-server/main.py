"""MCP Server entry point."""

# Import and run the server directly
if __name__ == "__main__":
    from server.main import mcp
    
    # Start the server with Streamable HTTP transport
    mcp.run(transport="streamable-http")