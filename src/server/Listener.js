const _ = require('lodash');
const bodyParser = require('body-parser');
const enableDestroy = require('server-destroy');
const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const requestLogService = require('./requestLogService');

class Listener {
	// Create new listener
	constructor (port) {
		const app = express();
		app.use(bodyParser.json());
		app.use((req, res, next) => {
			requestLogService.addEntry(req, res);
			next();
		});

		console.log(`Added listener on port ${port}`);

		this.port = port;
		this.mocks = {};
		this.app = app;
		this.server = createServer(port, app);
	}

	// Get mock
	get (uri, method) {
		return _.get(this.mocks[uri], method);
	}

	// Add mock
	add (options) {
		const {uri, method} = options;
		this.mocks[uri] = this.mocks[uri] || {};

		// Register mock if it hasn't been registered before
		if (!this.mocks[uri][method]) {
			this.app[method.toLowerCase()](uri, (req, res) => {
				return this.mocks[uri][method].handler(req, res);
			});
		}

		this.mocks[uri][method] = {
			options: options,
			clients: [],
			chunks: [],
			handler: this.getMockHandler(options)
		};
	}

	destroy () {
		this.server.destroy();
	}

	sendChunk (uri, chunk) {
		const mock = this.get(uri, 'GET');
		if (!mock) {
			throw new Error(`Mock does not exist ${this.port}/${uri}`);
		}

		mock.clients.forEach(client => client.write(chunk));
		mock.chunks.push(chunk);
		console.log('Chunk sent to', reqFm(mock.options.method, this.port, uri));
	}

	getMockHandler (options) {
		if (options.response) {
			return this.getStaticMockHandler(options);
		} else if (options.handler) {
			return this.getDynamicMockHandler(options);
		} else if (options.proxy) {
			return this.getProxyMockHandler(options);
		} else {
			return this.getStreamingMockHandler(options);
		}
	}

	// Returns static response
	getStaticMockHandler (options) {
		const {uri, response, method} = options;
		const statusCode = response.statusCode || 200;
		console.log(reqFm(method, this.port, uri), '(static)');
		return (req, res) => {
			requestLogService.setEntryType(req.id, 'static');
			res.set(response.headers);
			res.status(statusCode).send(response.body);
		};
	}

	// Returns dynamic handler that can change the response depending on the request
	getDynamicMockHandler (options) {
		const { uri, method, handler } = options;
		console.log(reqFm(method, this.port, uri), '(dynamic)');
		return (req, res) => {
			requestLogService.setEntryType(req.id, 'dynamic');
			return handler(req, res);
		};
	}

	// Proxies the request to another mock
	getProxyMockHandler (options) {
		const srcPort = this.port;
		const { uri, method } = options;
		const targetPort = options.proxy.target.substring(options.proxy.target.lastIndexOf(':') + 1);
		const proxy = httpProxy.createProxyServer(options.proxy);

		console.log(`${reqFm(method, srcPort, uri)} -> ${reqFm(method, targetPort, uri)}`, '(proxy)');
		return (req, res) => {
			requestLogService.setEntryType(req.id, 'proxy');
			proxy.web(req, res, e => {
				console.error(e);
				res.statusCode = 500;
				res.end(e.message);
			});
		};
	}

	// Returns a "keep-alive" response which can transport chunked responses
	getStreamingMockHandler (options) {
		const { uri, method } = options;

		console.log(reqFm(method, this.port, uri), '(streaming)');
		return (req, res) => {
			requestLogService.setEntryType(req.id, 'streaming');
			const mock = this.get(uri, method);
			req.on('close', () => _.pull(mock.clients, res)); // Remove listener
			mock.clients.push(res); // Add listener
			mock.chunks.forEach(chunk => res.write(chunk)); // Replay buffered chunks
		};
	}

	toString () {
		return _.mapValues(this.mocks, (mocks, uri) => {
			return _.mapValues(mocks, (mock, method) => {
				mock.clientsCount = mock.clients.length;
				return _.omit(mock, 'clients');
			});
		});
	}
}

function reqFm (method, port, uri, statusCode = '') {
	return `${method.toUpperCase()} http://localhost:${port}${uri} ${statusCode}`;
}

function createServer (port, app) {
	const server = http.Server(app);
	server.listen(port);
	enableDestroy(server);
	return server;
}

module.exports = Listener;
