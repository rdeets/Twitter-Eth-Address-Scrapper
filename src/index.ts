require('dotenv').config();
import { ExtendedClient } from './Client';
import { log } from 'console-styling';

export const client = new ExtendedClient({
	accessToken: `${process.env.ACCESS_TOKEN}`,
	accessSecret: `${process.env.ACCESS_TOKEN_SECRET}`,
	appKey: `${process.env.CONSUMER_KEY}`,
	appSecret: `${process.env.CONSUMER_SECRET}`
});

console.log(
	'------TWITTER ETH ADDRESS SCRAPPER------\n\n by Ryan Deets\n\nhttps://github.com/rdeets/\n'
);

const main = async () => {
	try {
		await client.start();
	} catch (error) {
		console.log(error);
		log(error, { preset: 'error' });
		client.saveAllFiles();
	}
};

main();
