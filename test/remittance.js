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
    
    const [sender, retriever, contractOwner, sender2] = accounts;
    const defaultDeadline = 3600; //1 hour
    const initialFee = bigNum(web3.utils.toWei('0.003'));
    let remitCont, fee;
    

    beforeEach("new contract deployment", async () => {
        remitCont = await Remittance.new(initialFee, { from: contractOwner });
        fee = bigNum(await remitCont.fee.call({ from: contractOwner }));
    });

    it ("Same inputs give different hash for different contracts", async() =>{
        const remitCont2 = await Remittance.new(initialFee, { from: contractOwner });
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const remittanceHashId2 = await remitCont2.hashIt(passwordToGiveRetriever, retriever);

        assert.notEqual(remittanceHashId, remittanceHashId2, "Same inputs give SAME hash for different contracts.");
    });

    it ('Reverts if remitting with deadline over deadline limit.', async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const deadlineLimit = bigNum(await remitCont.maxDeadline.call());

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, deadlineLimit.add(bigNum(1)), fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts original sender cancel before deadline.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
        await timeTravel(1800);
        await truffleAssert.reverts(remitCont.cancel(remittanceHashId, { from: sender }));
    });
    
    it ("Allows cancel by original sender if deadline passed.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        const txObjRemit = await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });

        assert.strictEqual(txObjRemit.logs[0].event, 'LogRemit', 'Wrong event emitted');
        assert.strictEqual(txObjRemit.logs[0].args.sender, sender, 'Remit Log Sender Error');
        assert.strictEqual(txObjRemit.logs[0].args.hashCode, remittanceHashId, 'Remit Log HashCode Error');
        assert.strictEqual(txObjRemit.logs[0].args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(txObjRemit.logs[0].args.deadline.toNumber(10), 
            (defaultDeadline + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        await timeTravel(3600*48 + 1);

        const senderInitial = bigNum(await web3.eth.getBalance(sender));
        const txObjCancel = await remitCont.cancel(remittanceHashId, { from: sender });

        assert.strictEqual(txObjCancel.logs[0].event, 'LogCancel', 'Wrong event emitted');
        assert.strictEqual(txObjCancel.logs[0].args.sender, sender, 'Cancel Log Sender Error');
        assert.strictEqual(txObjCancel.logs[0].args.hashCode, remittanceHashId, 'Cancel Log HashCode Error');
        assert.strictEqual(txObjCancel.logs[0].args.value.toString(10), amountToSend.sub(fee).toString(10), 'Cancel Log Value Error');
        assert.strictEqual(txObjCancel.logs[0].args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Cancel Log Timestamp Error');

        const senderGasCost = await gasCost(txObjCancel);
        const senderFinal = bigNum(await web3.eth.getBalance(sender));
        
        assert.strictEqual(senderInitial.sub(senderGasCost).sub(fee).toString(10),
            senderFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Reverts remit below the minimum remittance value.", async () => {
        const amountToSend = fee.sub(bigNum(1));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts remit with fee limit below current fee.", async() => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        const feeLimitBelow = fee.sub(bigNum(1));

        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, feeLimitBelow, { from: sender, value: amountToSend }));
    });
    
    it ("Reverts 0 value retrieve.", async () => {
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());

        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: sender }));
    });
    
    it ("Reverts remit to hash with existing value.", async () =>{
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: bigNum(web3.utils.toWei('1.77')) }));
    });
    
    it ("Can remit and retrieve properly.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        const txObjRemit = await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });

        assert.strictEqual(txObjRemit.logs[0].event, 'LogRemit', 'Wrong event emitted');
        assert.strictEqual(txObjRemit.logs[0].args.sender, sender, 'Remit Log Sender Error');
        assert.strictEqual(txObjRemit.logs[0].args.hashCode, remittanceHashId, 'Remit Log HashCode Error');
        assert.strictEqual(txObjRemit.logs[0].args.value.toString(10), amountToSend.toString(10), 'Remit Log Value Error');
        assert.strictEqual(txObjRemit.logs[0].args.deadline.toNumber(10), 
            (defaultDeadline + (await web3.eth.getBlock('latest')).timestamp), 'Remit Log Deadline Error');

        const retrieverInitial = bigNum(await web3.eth.getBalance(retriever));
        const txObjRet = await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });

        assert.strictEqual(txObjRet.logs[0].event, 'LogRetrieve', 'Wrong event emitted');
        assert.strictEqual(txObjRet.logs[0].args.retriever, retriever, 'Retrieve Log Retriever Error');
        assert.strictEqual(txObjRet.logs[0].args.hashCode, remittanceHashId, 'Retrieve Log HashCode Error');
        assert.strictEqual(txObjRet.logs[0].args.value.toString(10), amountToSend.sub(fee).toString(10), 'Retrieve Log Value Error');
        assert.strictEqual(txObjRet.logs[0].args.timestamp.toNumber(10), 
             (await web3.eth.getBlock('latest')).timestamp, 'Retrieve Log Timestamp Error');

        const retrieverGasCost = await gasCost(txObjRet);
        const retrieverFinal = bigNum(await web3.eth.getBalance(retriever));
        
        assert.strictEqual(retrieverInitial.sub(retrieverGasCost).sub(fee).toString(10),
            retrieverFinal.sub(amountToSend).toString(10), 'Expected balance incorrect.');
    });

    it ("Owner can retrieve fees properly.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = web3.utils.fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        const ownerInitial = bigNum(await web3.eth.getBalance(contractOwner));
        const txObjFee = await remitCont.withdrawFeePot({ from: contractOwner });

        assert.strictEqual(txObjFee.logs[0].event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(txObjFee.logs[0].args.account, contractOwner, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(contractOwner));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "Owner's expected balance incorrect.");
    });

    it ("Old owner can retreive fees even after transferring ownership.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const numRemits = 7;
        
        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = web3.utils.fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        await remitCont.pause({ from: contractOwner });

        const txObjTransfer = await remitCont.transferOwnership(sender, { from: contractOwner });

        assert.strictEqual(txObjTransfer.logs[0].event, 'PauserAdded', 'Wrong event emitted');
        assert.strictEqual(txObjTransfer.logs[0].args.account, sender, 'Pauser Log New Pauser Error');

        assert.strictEqual(txObjTransfer.logs[1].event, 'LogTransferOwnership', 'Wrong event emitted');
        assert.strictEqual(txObjTransfer.logs[1].args.oldOwner, contractOwner, 'Transfer Log Old Owner Error');
        assert.strictEqual(txObjTransfer.logs[1].args.newOwner, sender, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: sender });

        const ownerInitial = bigNum(await web3.eth.getBalance(contractOwner));
        const txObjFee = await remitCont.withdrawFeePot({ from: contractOwner });

        assert.strictEqual(txObjFee.logs[0].event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(txObjFee.logs[0].args.account, contractOwner, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(contractOwner));

        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "Old owner's expected balance incorrect.");
    });

    it ("New owner retrieves correct fees after transferring ownership.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        let passwordToGiveRetriever, remittanceHashId;
        const fee = bigNum(await remitCont.fee.call());
        const numRemits = 7;

        passwordToGiveRetriever = web3.utils.fromAscii(generator());
        remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
        await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
        
        await remitCont.pause({ from: contractOwner });
        const txObjTransfer = await remitCont.transferOwnership(sender, { from: contractOwner });

        assert.strictEqual(txObjTransfer.logs[0].event, 'PauserAdded', 'Wrong event emitted');
        assert.strictEqual(txObjTransfer.logs[0].args.account, sender, 'Pauser Log New Pauser Error');

        assert.strictEqual(txObjTransfer.logs[1].event, 'LogTransferOwnership', 'Wrong event emitted');
        assert.strictEqual(txObjTransfer.logs[1].args.oldOwner, contractOwner, 'Transfer Log Old Owner Error');
        assert.strictEqual(txObjTransfer.logs[1].args.newOwner, sender, 'Transfer Log New Owner Error');

        await remitCont.unpause({ from: sender });

        let i = 0;
        while(i < numRemits){
            passwordToGiveRetriever = web3.utils.fromAscii(generator());
            remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
            await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender2, value: amountToSend });
            await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
            i = i + 1;
        }

        const ownerInitial = bigNum(await web3.eth.getBalance(sender));
        const txObjFee = await remitCont.withdrawFeePot({ from: sender });

        assert.strictEqual(txObjFee.logs[0].event, 'LogWithdrawFeePot', 'Wrong event emitted');
        assert.strictEqual(txObjFee.logs[0].args.account, sender, 'Fee Pot Log Account Error');
        assert.strictEqual(txObjFee.logs[0].args.value.toString(10), fee.mul(bigNum(numRemits)).toString(10), 'Fee Pot Log Value Error');

        const ownerGasCost = await gasCost(txObjFee);
        const ownerFinal = bigNum(await web3.eth.getBalance(sender));



        await assert.strictEqual(ownerInitial.sub(ownerGasCost).toString(10),
            ownerFinal.sub(fee.mul(bigNum(numRemits))).toString(10), "New owner's expected balance incorrect.");
    });

    it ("Reverts if remitting with previously used hash.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
        await timeTravel(1800);
        await remitCont.retrieve(passwordToGiveRetriever, { from: retriever });
        await timeTravel(3600 * 72);
        truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender2, value: amountToSend }));
    });

    it ("Only owner can change fees.", async () => {
        const newFee = bigNum(web3.utils.toWei('0.5'));

        await truffleAssert.reverts(remitCont.setFee(newFee, { from: sender }));

        let txObjSetFee = await remitCont.setFee(newFee, { from: contractOwner });
        assert.strictEqual(txObjSetFee.logs[0].args.account, contractOwner, 'Set Fee Log Account Error');
        assert.strictEqual(txObjSetFee.logs[0].args.newFee.toString(10), newFee.toString(10), 'Set Fee Log New Fee Error');

        const currentFee = bigNum(await remitCont.fee.call());
        assert.strictEqual(currentFee.toString(10), newFee.toString(10), 'Fee incorrect after setting.')

        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        // test that remitting with old fee regets reverted.
        truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend }));
        
    });

    it ("Reverts retrieving when contract paused.", async () =>{
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend });
        await remitCont.pause({ from: contractOwner });
        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: retriever }));
    });

    it ("Reverts remitting when contract is paused.", async () =>{
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);

        await remitCont.pause({ from: contractOwner });
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender, value: amountToSend }));
    });

    it ("Reverts killing when contract is not paused.", async () => {
        await truffleAssert.reverts(remitCont.kill({ from: sender }));
    });

    it ("Reverts killing by non-pauser/owner.", async () => {
        await remitCont.pause( {from: contractOwner });
        await truffleAssert.reverts(remitCont.kill({ from: retriever }));
    });

    it ("Reverts post-killing withdrawal by non-owner.", async () => {
        await remitCont.pause( {from: contractOwner });
        await remitCont.kill( {from: contractOwner });
        await truffleAssert.reverts(remitCont.killedWithdrawal({ from: retriever }));
    });

    it ("Reverts post-killing withdrawal of 0 balance.", async () => {
        await remitCont.pause({ from: contractOwner });
        await remitCont.kill({ from: contractOwner });
        await truffleAssert.reverts(remitCont.killedWithdrawal({ from: contractOwner }));
    });

    it ("Post-killing withdrawal moves funds to the owner correctly.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultDeadline, fee, {from: sender, value: amountToSend});
        await remitCont.pause({ from: contractOwner });
        await remitCont.kill({ from: contractOwner });

        const contractOwnerBalBefore = bigNum(await web3.eth.getBalance(contractOwner));

        const txObjKW = await remitCont.killedWithdrawal({ from: contractOwner });

        assert.strictEqual(txObjKW.logs[0].event, 'LogKilledWithdrawal', 'Wrong event emitted');
        assert.strictEqual(txObjKW.logs[0].args.account, contractOwner, 'Killed Withdrawal Log Account Error');
        assert.strictEqual(txObjKW.logs[0].args.value.toString(10), amountToSend.toString(10), 'Killed Withdrawal Log Value Error');
    
        const contractOwnerGasCost = await gasCost(txObjKW);
        const contractOwnerBalAfter = bigNum(await web3.eth.getBalance(contractOwner));

        assert.strictEqual(contractOwnerBalBefore.sub(contractOwnerGasCost).toString(10),
            contractOwnerBalAfter.sub(amountToSend).toString(10), "David's expected balance incorrect.");
    });

    it ("Post-killing contract functions revert upon invocation.", async () => {
        const amountToSend = bigNum(web3.utils.toWei('0.01'));
        const passwordToGiveRetriever = web3.utils.fromAscii(generator());
        const remittanceHashId = await remitCont.hashIt(passwordToGiveRetriever, retriever);
        
        await remitCont.remit(remittanceHashId, defaultDeadline, fee, {from: sender, value: amountToSend});
        await remitCont.pause({ from: contractOwner });		
        await remitCont.kill({ from: contractOwner });
        await remitCont.unpause({ from: contractOwner });		

        await truffleAssert.reverts(remitCont.retrieve(passwordToGiveRetriever, { from: retriever }));
        await truffleAssert.reverts(remitCont.remit(remittanceHashId, defaultDeadline, fee, { from: sender }));
        await timeTravel(3600 * 72);
        await truffleAssert.reverts(remitCont.cancel(remittanceHashId, { from: sender }));
        await truffleAssert.reverts(remitCont.withdrawFeePot({ from: contractOwner }));
    });
})