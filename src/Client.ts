import { TwitterApiReadOnly, Tweetv2TimelineResult } from 'twitter-api-v2';
import fs from 'fs';
import readline from 'readline';

export class ExtendedClient extends TwitterApiReadOnly {
	//Map address -> username
	ensNames: Map<string, string>;
	ethAddresses: Map<string, string>;

	constructor({ appKey, appSecret, accessToken, accessSecret }) {
		super({ appKey, appSecret, accessToken, accessSecret });
	}

	async start() {
		try {
			// Make 'export' directory if it doesn't exist
			if (!fs.existsSync('./export')) {
				fs.mkdirSync('./export');
			}

			//Fetch saved files
			this.ensNames = new Map(
				fs.existsSync('./export/ensNames.json')
					? Object.entries(
							JSON.parse(
								fs.readFileSync('./export/ensNames.json', 'utf8') || '{}'
							)
					  )
					: []
			);

			this.ethAddresses = new Map(
				fs.existsSync('./export/ensNames.json')
					? Object.entries(
							JSON.parse(
								fs.readFileSync('./export/ethAddresses.json', 'utf8') || '{}'
							)
					  )
					: []
			);

			await this.appLogin();
			console.log('Logged in');

			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});
			const prompt = (query) =>
				new Promise<string>((resolve) => rl.question(query, resolve));

			try {
				const tweetURL = await prompt('URL of tweet to scrape: ');
				rl.close();
				await this.getTweet(tweetURL.split('status/')[1]);
			} catch (e) {
				console.error('Unable to get tweet: ', e);
			}
		} catch (error) {
			console.log('Login failed: ', error);
			process.exit();
		}
	}

	async getTweet(tweetId: string) {
		await this.v2
			.singleTweet(tweetId, {
				'tweet.fields': ['author_id', 'conversation_id']
			})
			.then(async (tweet) => {
				await this.getReplies(tweet.data.conversation_id, 1);
			})
			.catch((err) => console.log(err));
	}

	async getReplies(conversationId: string, page: number, next?: string) {
		await this.v2
			.get<Tweetv2TimelineResult>('tweets/search/recent', {
				query: `conversation_id: ${conversationId}`,
				expansions: ['author_id'],
				next_token: next
			})
			.then(async (replies) => {
				if (replies.meta.result_count === 0) {
					return console.log('No replies found in the last 7 days');
				}

				replies.data.forEach((reply) => {
					const ethAddress = reply.text.match(/0x[a-fA-F0-9]{40}/);
					if (ethAddress) {
						this.ethAddresses.set(ethAddress[0], reply.author_id);
					} else if (reply.text.toLowerCase().match(/.+?(?=\.eth)/)) {
						// Check for ENS name
						this.ensNames.set(
							reply.text
								.toLowerCase()
								.split(/\s|\\n/)
								.find((word) => word.includes('.eth')),
							reply.author_id
						);
					}
				});

				// Check if there are more replies to loop through
				if (replies.data.length === 10) {
					if (page % 180 === 0 && page !== 0) {
						console.log('Pausing for 15 mins to avoid rate limit');
						await new Promise((resolve) => setTimeout(resolve, 15 * 60 * 1000));
					}
					await this.getReplies(
						conversationId,
						page + 1,
						replies.meta.next_token
					);
				} else {
					fs.writeFile(
						'./export/ensNames.json',
						JSON.stringify(Object.fromEntries(this.ensNames)),
						(err) => {
							if (err) throw err;
							console.log(
								`${this.ensNames.size} ENS names saved to export/ensNames.json`
							);
						}
					);

					fs.writeFile(
						'./export/ethAddresses.json',
						JSON.stringify(Object.fromEntries(this.ethAddresses)),
						(err) => {
							if (err) throw err;
							console.log(
								`${this.ethAddresses.size} ETH addresses saved to export/ethAddresses.json`
							);
						}
					);
				}
			});
	}
}
