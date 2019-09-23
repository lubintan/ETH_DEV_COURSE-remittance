const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");
const { toBN, toWei, fromAscii } = web3.utils;
const codeGen = require('./../app/js/codeGenerator.js');
const generator = codeGen.generator;

const gasCost = async function (txObj) {
    const gasUsed = toBN(txObj.receipt.gasUsed);
    const txtx = await web3.eth.getTransaction(txObj.tx);
    const gasPrice = toBN(txtx.gasPrice);

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
    
    const [sender, retriever, contractOwner, sender2] = accounts;
    const defaultActivePeriod = 3600; //1 hour
    const initialFee = toBN(toWei('0.003'));
    let remitCont, fee;
    

    beforeEach("new contract deployment", async function() {
        remitCont = await Remittance.new(initialFee, { from: contractOwner });
        fee = toBN(await remitCont.fee.call({ from: contractOwner }));
    });

    it ("Same inputs give different hash for different contracts", async function(){
        const remitCont2 = await Remittance.new(initialFee, { from: contractOwner });
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const remittanceHashId2 = await remitCont2.hashIt(passwordToGiveRetriever, retriever);

        assert.notEqual(remittanceHashId, remittanceHashId2, "Same inputs give SAME hash for different contracts.");
    });

    it ('Reverts if remitting with active period over active period limit.', async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const activePeriodLimit = toBN(await remitCont.maxActivePeriod.call());

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, activePeriodLimit.add(toBN(1)), fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts original sender cancel before deadline.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
        await timeTravel(1800);
        await truffleAssert.reverts(remitCont.cancel(remittanceHashId, { from: sender }));
    });
    
    it ("Allows cancel by original sender if deadline passed.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        const txObjRemit = await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });

        const remitEvent = txObjRemit.logs[0];
        assert.strictEqual(remitEvent.event, 'LogRemit', 'Wrong event emitted');
        assert.strictEqual(remitEvent.args.sender, sender, 'Remit Log Sender Error');
        assert.strictEqual(remitEvent.args.hashCode, remittanceHashId, 'Remit Log HashCode Error');
        assert.strictEqual(remitEvent.args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(remitEvent.args.deadline.toNumber(10), 
            (defaultActivePeriod + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        await timeTravel(3600*48 + 1);

        const senderInitial = toBN(await web3.eth.getBalance(sender));
        const txObjCancel = await remitCont.cancel(remittanceHashId, { from: sender });

        const cancelEvent = txObjCancel.logs[0];
        assert.strictEqual(cancelEvent.event, 'LogCancel', 'Wrong event emitted');
        assert.strictEqual(cancelEvent.args.sender, sender, 'Cancel Log Sender Error');
        assert.strictEqual(cancelEvent.args.hashCode, remittanceHashId, 'Cancel Log HashCode Error');
        assert.strictEqual(cancelEvent.args.value.toString(10), amountToSend.sub(fee).toString(10), 'Cancel Log Value Error');
        assert.strictEqual(cancelEvent.args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Cancel Log Timestamp Error');

        const senderGasCost = await gasCost(txObjCancel);
        const senderFinal = toBN(await web3.eth.getBalance(sender));
        
        assert.strictEqual(senderInitial.sub(senderGasCost).sub(fee).toString(10),
            senderFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Reverts remit below the minimum remittance value.", async function() {
        const amountToSend = fee.sub(toBN(1));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts remit with fee limit below current fee.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const feeLimitBelow = fee.sub(toBN(1));

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, feeLimitBelow, { from: sender, value: amountToSend }));
    });
    
    it ("Reverts 0 value retrieve.", async function() {
        const passwordToGiveRetriever = fromAscii(generator());

        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: sender }));
    });
    
    it ("Reverts remit to hash with existing value.", async function(){
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: toBN(toWei('1.77')) }));
    });
    
    it ("Can remit and retrieve properly.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        const txObjRemit = await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });

        const remitEvent = txObjRemit.logs[0];
        assert.strictEqual(remitEvent.event, 'LogRemit', 'Wrong event emitted');
        assert.strictEqual(remitEvent.args.sender, sender, 'Remit Log Sender Error');
        assert.strictEqual(remitEvent.args.hashCode, remittanceHashId, 'Remit Log HashCode Error');
        assert.strictEqual(remitEvent.args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(remitEvent.args.deadline.toNumber(10), 
            (defaultActivePeriod + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        const retrieverInitial = toBN(await web3.eth.getBalance(retriever));
        const txObjRet = await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });

        const retEvent = txObjRet.logs[0];
        assert.strictEqual(retEvent.event, 'LogRetrieve', 'Wrong event emitted');
        assert.strictEqual(retEvent.args.retriever, retriever, 'Retrieve Log Retriever Error');
        assert.strictEqual(retEvent.args.hashCode, remittanceHashId, 'Retrieve Log HashCode Error');
        assert.strictEqual(retEvent.args.value.toString(10), amountToSend.sub(fee).toString(10), 'Retrieve Log Value Error');
        assert.strictEqual(retEvent.args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Retrieve Log Timestamp Error');

        const retrieverGasCost = await gasCost(txObjRet);
        const retrieverFinal = toBN(await web3.eth.getBalance(retriever));
        
        assert.strictEqual(retrieverInitial.sub(retrieverGasCost).sub(fee).toString(10),
            retrieverFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Owner can retrieve fees properly.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        const ownerInitial = toBN(await web3.eth.getBalance(contractOwner));
        const txObjFee = await remitCont.withdrawFeePot({ from: contractOwner });

        const feeEvent = txObjFee.logs[0];
        assert.strictEqual(feeEvent.event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(feeEvent.args.account, contractOwner, 'Fee Pot Log Account Error');
        assert.strictEqual(feeEvent.args.value.toString(10), fee.mul(toBN(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = toBN(await web3.eth.getBalance(contractOwner));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(toBN(numRemits))).toString(10), "Owner's expected balance incorrect.");
    });

    it ("Old owner can retreive fees even after transferring ownership.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        await remitCont.pause({ from: contractOwner });

        const txObjTransfer = await remitCont.transferOwnership(sender, { from: contractOwner });

        const transferEvent = txObjTransfer.logs[0];
        assert.strictEqual(transferEvent.event, 'PauserAdded', 'Wrong event emitted');
        assert.strictEqual(transferEvent.args.account, sender, 'Pauser Log New Pauser Error');

        const transferEvent2 = txObjTransfer.logs[1];
        assert.strictEqual(transferEvent2.event, 'LogTransferOwnership', 'Wrong event emitted');
        assert.strictEqual(transferEvent2.args.oldOwner, contractOwner, 'Transfer Log Old Owner Error');
        assert.strictEqual(transferEvent2.args.newOwner, sender, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: sender });

        const ownerInitial = toBN(await web3.eth.getBalance(contractOwner));
        const txObjFee = await remitCont.withdrawFeePot({ from: contractOwner });

        const feeEvent = txObjFee.logs[0];
        assert.strictEqual(feeEvent.event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(feeEvent.args.account, contractOwner, 'Fee Pot Log Account Error');
        assert.strictEqual(feeEvent.args.value.toString(10), fee.mul(toBN(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = toBN(await web3.eth.getBalance(contractOwner));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(toBN(numRemits))).toString(10), "Old owner's expected balance incorrect.");
    });

    it ("New owner retrieves correct fees after transferring ownership.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const fee = toBN(await remitCont.fee.call());
        const numRemits = 7;

        passwordToGiveRetriever = fromAscii(generator());
        remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
        await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
        
        await remitCont.pause({ from: contractOwner });
        const txObjTransfer = await remitCont.transferOwnership(sender, { from: contractOwner });

        const transferEvent = txObjTransfer.logs[0];
        assert.strictEqual(transferEvent.event, 'PauserAdded', 'Wrong event emitted');
        assert.strictEqual(transferEvent.args.account, sender, 'Pauser Log New Pauser Error');

        const transferEvent2 = txObjTransfer.logs[1];
        assert.strictEqual(transferEvent2.event, 'LogTransferOwnership', 'Wrong event emitted');
        assert.strictEqual(transferEvent2.args.oldOwner, contractOwner, 'Transfer Log Old Owner Error');
        assert.strictEqual(transferEvent2.args.newOwner, sender, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: sender });

        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender2, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        const ownerInitial = toBN(await web3.eth.getBalance(sender));
        const txObjFee = await remitCont.withdrawFeePot({ from: sender });

        const feeEvent = txObjFee.logs[0];
        assert.strictEqual(feeEvent.event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(feeEvent.args.account, sender, 'Fee Pot Log Account Error');
        assert.strictEqual(feeEvent.args.value.toString(10), fee.mul(toBN(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = toBN(await web3.eth.getBalance(sender));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(toBN(numRemits))).toString(10), "New owner's expected balance incorrect.");
    });

    it ("Reverts if remitting with previously used hash.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
        await timeTravel(1800);
        await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
        await timeTravel(3600 * 72);
        truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender2, value: amountToSend }));
    });

    it ("Only owner can change fees.", async function() {
        const newFee = toBN(toWei('0.5'));

        await truffleAssert.reverts(remitCont.setFee(newFee, { from: sender }));

        let txObjSetFee = await remitCont.setFee(newFee, { from: contractOwner });
        assert.strictEqual(txObjSetFee.logs[0].args.account, contractOwner, 'Set Fee Log Account Error');
        assert.strictEqual(txObjSetFee.logs[0].args.newFee.toString(10), newFee.toString(10), 'Set Fee Log New Fee Error');

        const currentFee = toBN(await remitCont.fee.call());
        assert.strictEqual(currentFee.toString(10), newFee.toString(10), 'Fee incorrect after setting.')

        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        // test that remitting with old fee regets reverted.
        truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend }));
        
    });

    it ("Reverts retrieving when contract paused.", async function(){
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend });
        await remitCont.pause({ from: contractOwner });
        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: retriever }));
    });

    it ("Reverts remitting when contract is paused.", async function(){
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.pause({ from: contractOwner });
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts killing when contract is not paused.", async function() {
        await truffleAssert.reverts(remitCont.kill({ from: sender }));
    });

    it ("Reverts killing by non-pauser/owner.", async function() {
        await remitCont.pause( {from: contractOwner });
        await truffleAssert.reverts(remitCont.kill({ from: retriever }));
    });

    it ("Reverts post-killing withdrawal by non-owner.", async function() {
        await remitCont.pause( {from: contractOwner });
        await remitCont.kill( {from: contractOwner });
        await truffleAssert.reverts(remitCont.killedWithdrawal({ from: retriever }));
    });

    it ("Reverts post-killing withdrawal of 0 balance.", async function() {
        await remitCont.pause({ from: contractOwner });
        await remitCont.kill({ from: contractOwner });
        await truffleAssert.reverts(remitCont.killedWithdrawal({ from: contractOwner }));
    });

    it ("Post-killing withdrawal moves funds to the owner correctly.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, {from: sender, value: amountToSend});
        await remitCont.pause({ from: contractOwner });
        await remitCont.kill({ from: contractOwner });

        const contractOwnerBalBefore = toBN(await web3.eth.getBalance(contractOwner));

        const txObjKW = await remitCont.killedWithdrawal({ from: contractOwner });

        const kwEvent = txObjKW.logs[0];
        assert.strictEqual(kwEvent.event, 'LogKilledWithdrawal', 'Wrong event emitted');
        assert.strictEqual(kwEvent.args.account, contractOwner, 'Killed Withdrawal Log Account Error');
        assert.strictEqual(kwEvent.args.value.toString(10), amountToSend.toString(10), 'Killed Withdrawal Log Value Error');
    
        const contractOwnerGasCost = await gasCost(txObjKW);
        const contractOwnerBalAfter = toBN(await web3.eth.getBalance(contractOwner));

        assert.strictEqual(contractOwnerBalBefore.sub(contractOwnerGasCost).toString(10),
            contractOwnerBalAfter.sub(amountToSend).toString(10), "David's expected balance incorrect.");
    });

    it ("Post-killing contract functions revert upon invocation.", async function() {
        const amountToSend = toBN(toWei('0.01'));
        const passwordToGiveRetriever = fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultActivePeriod, fee, {from: sender, value: amountToSend});
        await remitCont.pause({ from: contractOwner });		
        await remitCont.kill({ from: contractOwner });
        await remitCont.unpause({ from: contractOwner });		

        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: retriever }));
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultActivePeriod, fee, { from: sender }));
        await timeTravel(3600 * 72);
        await truffleAssert.reverts(remitCont.cancel(remittanceHashId, { from: sender }));
        await truffleAssert.reverts(remitCont.withdrawFeePot({ from: contractOwner }));
    });
})