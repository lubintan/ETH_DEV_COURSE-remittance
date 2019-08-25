const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");
// const web3 = require("web3");
const bigNum = web3.utils.toBN;
const seqPrm = require("./sequentialPromise.js");
const codeGen = require('./../app/js/codeGenerator.js');
const generator = codeGen.generator;

async function gasCost(tx) {
	const gasUsed = bigNum(tx.receipt.gasUsed);
	const txtx = await web3.eth.getTransaction(tx.tx);
	const gasPrice = bigNum(txtx.gasPrice);

	return gasPrice.mul(gasUsed);
}

const timeTravel = function (time) {
	return new Promise((resolve, reject) => {
	  web3.currentProvider.send({
		jsonrpc: "2.0",
		method: "evm_increaseTime",
		params: [time], // 86400 is num seconds in day
		id: new Date().getTime()
	  }, (err, result) => {
		if(err){ return reject(err) }
		return resolve(result)
	  });
	})
  }

contract('Remittance', function(accounts){
	
	const [alice, bob, carol, david] = accounts;
	const defaultDeadline = 3600; //1 hour
	let remitCont;
	
	beforeEach("new contract deployment", async () => {
		remitCont = await Remittance.new({ from: david });
	});

	/*
	The following checks are done based on the assumption that none of these accounts are mining,
	or have ether being credited to their balances while this test is being run.
	Expected balances are calculated based on the effects of the Splitter contract, and the 
	associated gas costs.
	*/

	it ("Same inputs give different hash for different contracts", async() =>{
		const remitCont2 = await Remittance.new({ from: david });
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, bob);
		const hashed2 = await remitCont2.hashIt(codeA, bob);

		assert.notEqual(hashed, hashed2, "Same inputs give SAME hash for different contracts.");
	});

	it ("Reverts retrieve if deadline passed.", async () => {
        const amountToSend = bigNum(5e8);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

        let tx = await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await timeTravel(3600*48 + 1);
		await truffleAssert.reverts(remitCont.retrieve(codeA, { from: carol }));
	});

	it ("Reverts original remitter cancel before deadline.", async () => {
		const amountToSend = bigNum(5e8);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

        let tx = await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await timeTravel(1800);
		await truffleAssert.reverts(remitCont.cancel(hashed, { from: alice }));
	});
	
	it ("Allows cancel by original remitter if deadline passed.", async () => {
		const amountToSend = bigNum(5e8);
		const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

		let tx = await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await truffleAssert.eventEmitted(tx, 'LogRemit');
		await timeTravel(3600*48 + 1);

		const aliceInitial = bigNum(await web3.eth.getBalance(alice));
		tx = await remitCont.cancel(hashed, { from: alice });
		await truffleAssert.eventEmitted(tx, 'LogCancel');

		const aliceGasCost = await gasCost(tx);
		const aliceFinal = bigNum(await web3.eth.getBalance(alice));
		
		assert.strictEqual(aliceInitial.sub(aliceGasCost).toString(10),
			aliceFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
	});

	it ("Reverts 0 value remit.", async () => {
        const amountToSend = bigNum(0);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

		await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend }));
	});
	
	it ("Reverts 0 value retrieve.", async () => {
        const codeA = generator();

		await truffleAssert.reverts(remitCont.retrieve(codeA, { from: alice }));
	});
	
	it ("Reverts remit to hash with existing value.", async () =>{
		const amountToSend = bigNum(5e8);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

		await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, { from: alice, value: bigNum(7e8) }));
	});
    
    it ("Can remit and retrieve properly.", async () => {
        const amountToSend = bigNum(5e8);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

        let tx = await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		// await truffleAssert.prettyPrintEmittedEvents(tx);
		await truffleAssert.eventEmitted(tx, 'LogRemit');

        const carolInitial = bigNum(await web3.eth.getBalance(carol));
		tx = await remitCont.retrieve(codeA, { from: carol });
		// await truffleAssert.prettyPrintEmittedEvents(tx);
		await truffleAssert.eventEmitted(tx, 'LogRetrieve');

		const carolGasCost = await gasCost(tx);
        const carolFinal = bigNum(await web3.eth.getBalance(carol));
		
		assert.strictEqual(carolInitial.sub(carolGasCost).toString(10),
			carolFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
	});

    it ("Reverts if remitting with previously used hash.", async () => {
        const amountToSend = bigNum(5e8);
        const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

		let tx = await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await timeTravel(1800);
		tx = await remitCont.retrieve(codeA, { from: carol });
		await timeTravel(3600 * 72);
		truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, { from: bob, value: amountToSend }));
    });

	it ("Reverts retrieving when contract paused.", async () =>{
		const amountToSend = bigNum(5e8);
		const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);
		
		await remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend });
		await remitCont.pause({ from: david });
		await truffleAssert.reverts(remitCont.retrieve(codeA, { from: carol }));
	});

	it ("Reverts remitting when contract is paused.", async () =>{
		const amountToSend = bigNum(5e8);
		const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);

		await remitCont.pause({ from: david });
		await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, { from: alice, value: amountToSend }));
	});

	it ("Reverts killing when contract is not paused.", async () => {
		await truffleAssert.reverts(remitCont.kill({ from: alice }));
	});

	it ("Reverts killing by non-pauser/owner.", async () => {
		await remitCont.pause( {from: david });
		await truffleAssert.reverts(remitCont.kill({ from: carol }));
	});

	it ("Reverts post-killing withdrawal by non-owner.", async () => {
		await remitCont.pause( {from: david });
		await remitCont.kill( {from: david });
		await truffleAssert.reverts(remitCont.killedWithdrawal({ from: carol }));
	});

	it ("Reverts post-killing withdrawal of 0 balance.", async () => {
		await remitCont.pause({ from: david });
		await remitCont.kill({ from: david });
		await truffleAssert.reverts(remitCont.killedWithdrawal({ from: david }));
	});

	it ("Post-killing withdrawal moves funds to the owner correctly.", async () => {
		const amountToSend = bigNum(5e8);
		const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);
		
		await remitCont.remit(hashed, defaultDeadline, {from: alice, value: amountToSend});
		await remitCont.pause({ from: david });
		await remitCont.kill({ from: david });
		
		const davidBalBefore = bigNum(await web3.eth.getBalance(david));
		const tx = await remitCont.killedWithdrawal({ from: david });	
		const davidGasCost = await gasCost(tx);
		const davidBalAfter = bigNum(await web3.eth.getBalance(david));

		assert.strictEqual(davidBalBefore.sub(davidGasCost).toString(10),
			davidBalAfter.sub(amountToSend).toString(10), "David's expected balance incorrect.");
	});

	it ("Post-killing contract functions revert upon invocation.", async () => {
		const amountToSend = bigNum(5e8);
		const codeA = generator();
		const hashed = await remitCont.hashIt(codeA, carol);
		
		await remitCont.remit(hashed, defaultDeadline, {from: alice, value: amountToSend});
		await remitCont.pause({ from: david });		
		await remitCont.kill({ from: david });
		await remitCont.unpause({ from: david });		

		await truffleAssert.reverts(remitCont.retrieve(codeA, { from: carol }));
		await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, { from: alice }));
		await timeTravel(3600 * 72);
		await truffleAssert.reverts(remitCont.cancel(hashed, { from: alice }));
	});
})