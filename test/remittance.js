const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");
// const web3 = require("web3");
const bigNum = web3.utils.toBN;
const seqPrm = require("./sequentialPromise.js");
const codeGen = require('./../app/js/codeGenerator.js');
const generator = codeGen.generator;

async function gasCost(txObj) {
    const gasUsed = bigNum(txObj.receipt.gasUsed);
    const txtx = await web3.eth.getTransaction(txObj.tx);
    const gasPrice = bigNum(txtx.gasPrice);

    return gasPrice.mul(gasUsed);
}

const timeTravel =  async function (duration) {
    await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [duration], // 86400 is num seconds in day
        id: new Date().getTime()
        }, (err, result) => {
            if(err){ return err; }
            return result;
        }
    );
}

contract('Remittance', function(accounts){
    
    const [alice, bob, carol, david] = accounts;
    const defaultDeadline = 3600; //1 hour
    let remitCont, fee;
    
    beforeEach("new contract deployment", async () => {
        remitCont = await Remittance.new({ from: david });
        fee = bigNum(await remitCont.fee.call({ from: david }));
    });

    it ("Same inputs give different hash for different contracts", async() =>{
        const remitCont2 = await Remittance.new({ from: david });
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, bob);
        const hashed2 = await remitCont2.hashIt(codeA, bob);

        assert.notEqual(hashed, hashed2, "Same inputs give SAME hash for different contracts.");
    });

    it ('Reverts if remitting with deadline over deadline limit.', async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);
        const deadlineLimit = bigNum(await remitCont.maxDeadline.call());

        await truffleAssert.reverts(remitCont.remit(hashed, deadlineLimit.add(bigNum(1)), fee, { from: alice, value: amountToSend }));
    });

    it ("Reverts original remitter cancel before deadline.", async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await timeTravel(1800);
        await truffleAssert.reverts(remitCont.cancel(hashed, { from: alice }));
    });
    
    it ("Allows cancel by original remitter if deadline passed.", async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        const txObjRemit = await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await truffleAssert.eventEmitted(txObjRemit, 'LogRemit');

        assert.strictEqual(txObjRemit.logs[0].args.sender, alice, 'Remit Log Sender Error');
        assert.strictEqual(txObjRemit.logs[0].args.hashCode, hashed, 'Remit Log HashCode Error');
        assert.strictEqual(txObjRemit.logs[0].args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(txObjRemit.logs[0].args.deadline.toNumber(10), 
            (defaultDeadline + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        await timeTravel(3600*48 + 1);

        const aliceInitial = bigNum(await web3.eth.getBalance(alice));
        const txObjCancel = await remitCont.cancel(hashed, { from: alice });
        await truffleAssert.eventEmitted(txObjCancel, 'LogCancel');

        assert.strictEqual(txObjCancel.logs[0].args.sender, alice, 'Cancel Log Sender Error');
        assert.strictEqual(txObjCancel.logs[0].args.hashCode, hashed, 'Cancel Log HashCode Error');
        assert.strictEqual(txObjCancel.logs[0].args.value.toString(10), amountToSend.sub(fee).toString(10), 'Cancel Log Value Error');
        assert.strictEqual(txObjCancel.logs[0].args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Cancel Log Timestamp Error');

        const aliceGasCost = await gasCost(txObjCancel);
        const aliceFinal = bigNum(await web3.eth.getBalance(alice));
        
        assert.strictEqual(aliceInitial.sub(aliceGasCost).sub(fee).toString(10),
            aliceFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Reverts remit below the minimum remittance value.", async () => {
        const amountToSend = fee.sub(bigNum(1));
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend }));
    });

    it ("Reverts remit with fee limit below current fee.", async() => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);
        const feeLimitBelow = fee.sub(bigNum(1));

        await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, feeLimitBelow, { from: alice, value: amountToSend }));
    });
    
    it ("Reverts 0 value retrieve.", async () => {
        const codeA = web3.utils.fromAscii(generator());

        await truffleAssert.reverts(remitCont.retrieve(codeA, { from: alice }));
    });
    
    it ("Reverts remit to hash with existing value.", async () =>{
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: bigNum(1.77e18) }));
    });
    
    it ("Can remit and retrieve properly.", async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        const txObjRemit = await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await truffleAssert.eventEmitted(txObjRemit, 'LogRemit');

        assert.strictEqual(txObjRemit.logs[0].args.sender, alice, 'Remit Log Sender Error');
        assert.strictEqual(txObjRemit.logs[0].args.hashCode, hashed, 'Remit Log HashCode Error');
        assert.strictEqual(txObjRemit.logs[0].args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(txObjRemit.logs[0].args.deadline.toNumber(10), 
            (defaultDeadline + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        const carolInitial = bigNum(await web3.eth.getBalance(carol));
        const txObjRet = await remitCont.retrieve(codeA, { from: carol });
        await truffleAssert.eventEmitted(txObjRet, 'LogRetrieve');

        assert.strictEqual(txObjRet.logs[0].args.retriever, carol, 'Retrieve Log Retriever Error');
        assert.strictEqual(txObjRet.logs[0].args.hashCode, hashed, 'Retrieve Log HashCode Error');
        assert.strictEqual(txObjRet.logs[0].args.value.toString(10), amountToSend.sub(fee).toString(10), 'Retrieve Log Value Error');
        assert.strictEqual(txObjRet.logs[0].args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Retrieve Log Timestamp Error');

        const carolGasCost = await gasCost(txObjRet);
        const carolFinal = bigNum(await web3.eth.getBalance(carol));
        
        assert.strictEqual(carolInitial.sub(carolGasCost).sub(fee).toString(10),
            carolFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Owner can retrieve fees properly.", async () => {
        const amountToSend = bigNum(1e16);
        let codeA, hashed;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            codeA = web3.utils.fromAscii(generator());
            hashed = await remitCont.hashIt(codeA, carol);
            await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
            await remitCont.retrieve(codeA, { from: carol });
            i = i + 1;
        }

        const ownerInitial = bigNum(await web3.eth.getBalance(david));
        const txObjFee = await remitCont.withdrawFeePot({ from: david });
        await truffleAssert.eventEmitted(txObjFee, 'LogWithdrawFeePot');

        assert.strictEqual(txObjFee.logs[0].args.account, david, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(david));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "Owner's expected balance incorrect.");
    });

    it ("Old owner can retreive fees even after transferring ownership.", async () => {
        const amountToSend = bigNum(1e16);
        let codeA, hashed;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            codeA = web3.utils.fromAscii(generator());
            hashed = await remitCont.hashIt(codeA, carol);
            await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
            await remitCont.retrieve(codeA, { from: carol });
            i = i + 1;
        }

        await remitCont.pause({ from: david });

        const txObjTransfer = await remitCont.transferOwnership(alice, { from: david });
        await truffleAssert.eventEmitted(txObjTransfer, 'LogTransferOwnership');

        assert.strictEqual(txObjTransfer.logs[0].args.account, alice, 'Pauser Log New Pauser Error');
        assert.strictEqual(txObjTransfer.logs[1].args.oldOwner, david, 'Transfer Log Old Owner Error');
        assert.strictEqual(txObjTransfer.logs[1].args.newOwner, alice, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: alice });

        const ownerInitial = bigNum(await web3.eth.getBalance(david));
        const txObjFee = await remitCont.withdrawFeePot({ from: david });
        await truffleAssert.eventEmitted(txObjFee, 'LogWithdrawFeePot');

        assert.strictEqual(txObjFee.logs[0].args.account, david, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(david));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "Old owner's expected balance incorrect.");
    });

    it ("New owner retrieves correct fees after transferring ownership.", async () => {
        const amountToSend = bigNum(1e16);
        let codeA, hashed;
        const fee = bigNum(await remitCont.fee.call());
        const numRemits = 7;

        codeA = web3.utils.fromAscii(generator());
        hashed = await remitCont.hashIt(codeA, carol);
        await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await remitCont.retrieve(codeA, { from: carol });
        
        await remitCont.pause({ from: david });
        const txObjTransfer = await remitCont.transferOwnership(alice, { from: david });
        await truffleAssert.eventEmitted(txObjTransfer, 'LogTransferOwnership');

        assert.strictEqual(txObjTransfer.logs[0].args.account, alice, 'Pauser Log New Pauser Error');
        assert.strictEqual(txObjTransfer.logs[1].args.oldOwner, david, 'Transfer Log Old Owner Error');
        assert.strictEqual(txObjTransfer.logs[1].args.newOwner, alice, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: alice });

        let i = 0;
        while(i < numRemits){
            codeA = web3.utils.fromAscii(generator());
            hashed = await remitCont.hashIt(codeA, carol);
            await remitCont.remit(hashed, defaultDeadline, fee, { from: bob, value: amountToSend });
            await remitCont.retrieve(codeA, { from: carol });
            i = i + 1;
        }

        const ownerInitial = bigNum(await web3.eth.getBalance(alice));
        const txObjFee = await remitCont.withdrawFeePot({ from: alice });
        await truffleAssert.eventEmitted(txObjFee, 'LogWithdrawFeePot');

        assert.strictEqual(txObjFee.logs[0].args.account, alice, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(alice));



        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "New owner's expected balance incorrect.");
    });

    it ("Reverts if remitting with previously used hash.", async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await timeTravel(1800);
        await remitCont.retrieve(codeA, { from: carol });
        await timeTravel(3600 * 72);
        truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: bob, value: amountToSend }));
    });

    it ("Only owner can change fees.", async () => {
        const newFee = bigNum(5e17);

        await truffleAssert.reverts(remitCont.setFee(newFee, { from: alice }));

        let txObjSetFee = await remitCont.setFee(newFee, { from: david });
        assert.strictEqual(txObjSetFee.logs[0].args.account, david, 'Set Fee Log Account Error');
        assert.strictEqual(txObjSetFee.logs[0].args.newFee.toString(10), newFee.toString(10), 'Set Fee Log New Fee Error');

        const currentFee = bigNum(await remitCont.fee.call());
        assert.strictEqual(currentFee.toString(10), newFee.toString(10), 'Fee incorrect after setting.')

        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        // test that remitting with old fee regets reverted.
        truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend }));
        
    });

    it ("Reverts retrieving when contract paused.", async () =>{
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);
        
        await remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend });
        await remitCont.pause({ from: david });
        await truffleAssert.reverts(remitCont.retrieve(codeA, { from: carol }));
    });

    it ("Reverts remitting when contract is paused.", async () =>{
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);

        await remitCont.pause({ from: david });
        await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: alice, value: amountToSend }));
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
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);
        
        await remitCont.remit(hashed, defaultDeadline, fee, {from: alice, value: amountToSend});
        await remitCont.pause({ from: david });
        await remitCont.kill({ from: david });

        const davidBalBefore = bigNum(await web3.eth.getBalance(david));

        const txObjKW = await remitCont.killedWithdrawal({ from: david });
        await truffleAssert.eventEmitted(txObjKW, 'LogKilledWithdrawal');
        assert.strictEqual(txObjKW.logs[0].args.account, david, 'Killed Withdrawal Log Account Error');
        assert.strictEqual(txObjKW.logs[0].args.value.toString(10), amountToSend.toString(10), 'Killed Withdrawal Log Value Error');
    
        const davidGasCost = await gasCost(txObjKW);
        const davidBalAfter = bigNum(await web3.eth.getBalance(david));

        assert.strictEqual(davidBalBefore.sub(davidGasCost).toString(10),
            davidBalAfter.sub(amountToSend).toString(10), "David's expected balance incorrect.");
    });

    it ("Post-killing contract functions revert upon invocation.", async () => {
        const amountToSend = bigNum(1e16);
        const codeA = web3.utils.fromAscii(generator());
        const hashed = await remitCont.hashIt(codeA, carol);
        
        await remitCont.remit(hashed, defaultDeadline, fee, {from: alice, value: amountToSend});
        await remitCont.pause({ from: david });		
        await remitCont.kill({ from: david });
        await remitCont.unpause({ from: david });		

        await truffleAssert.reverts(remitCont.retrieve(codeA, { from: carol }));
        await truffleAssert.reverts(remitCont.remit(hashed, defaultDeadline, fee, { from: alice }));
        await timeTravel(3600 * 72);
        await truffleAssert.reverts(remitCont.cancel(hashed, { from: alice }));
        await truffleAssert.reverts(remitCont.withdrawFeePot({ from: david }));
    });
})