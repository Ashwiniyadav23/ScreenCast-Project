import app, { connectDB } from '../server.js';

export default async function handler(req, res) {
	try {
		await connectDB();
		return app(req, res);
	} catch (error) {
		console.error('Server initialization error:', error);
		return res.status(500).json({
			message: 'Server initialization failed',
			error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
		});
	}
}