const Web3 = require("web3");
const Promise = require("bluebird");
const truffleContract = require("truffle-contract");
const $ = require("jquery");
const remitJson = require("../../build/contracts/Remittance.json");
const bigNum = Web3.utils.toBN;
const codeGen = require('./codeGenerator.js');
const generator = codeGen.generator;

let codeA, remitToAddr, hashed;


// Supports Metamask, and other wallets that provide / inject 'web3'.
if (typeof web3 !== 'undefined') {
    // Use the Mist/wallet/Metamask provider.
    window.web3 = new Web3(web3.currentProvider);
} else {
    // Your preferred fallback.
    window.web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545')); 
}

const Remittance = truffleContract(remitJson);
Remittance.setProvider(web3.currentProvider);

const codeGenAction = async () => {
    try{
        let deployed = await Remittance.deployed();
        codeA = generator();
        remitToAddr = $("select[id='remitToAddr']").val();
        hashed = await deployed.hashIt(codeA, remitToAddr);
        
        $("#codeA").html(codeA);
        $("#hashed").html(hashed);
        $("#hashStatus").html("Hashed " + codeA + " successfully to get <br> " + hashed + ".");
    }catch (e){
        let errorString = e.toString();
        $("#hashStatus").html(errorString);
        console.error(e);
    }
}

const remitAction = async() => {
    // Sometimes you have to force the gas amount to a value you know is enough because
    // `web3.eth.estimateGas` may get it wrong.
    // We simulate the real call and see whether this is likely to work.
    try{
        const gas = 300000; 
        let txId;
        const from = $("select[id='remitAddr']").val();
        const value = bigNum($("input[name='amount']").val());
        const deadline = bigNum($("input[name='deadline']").val());
        let deployed = await Remittance.deployed();
        let simResult = await deployed.remit.call(
            hashed,
            deadline,
            {
            from: from,
            value: value,
            gas:gas
            });
        
        if (await !simResult) {
            throw new Error("The transaction will fail anyway, not sending");
        }
        // Ok, we move onto the proper action.
        await deployed.remit(
            hashed,
            deadline,
            {
            from: from,
            value: value,
            gas:gas
            }
        )
        .on(
            "transactionHash",
            txHash => {
                txId = txHash;
                $("#remitStatus").html("Created Transaction: " + txHash);
            }
        )
        .on(
            "receipt", receipt =>{
                if (!receipt.status) {
                    console.error("Wrong status");
                    console.error(receipt);
                    $("#remitStatus").html("There was an error in the tx execution, status not 1");
                    $("#logRemitFrom").html("NA");
                    $("#logRemitHash").html("NA");
                    $("#logRemitValue").html("NA");
                    $("#logRemitTimestamp").html("NA");
                } else if (receipt.logs.length == 0) {
                    console.error("Empty logs");
                    console.error(receipt);
                    $("#remitStatus").html("There was an error in the tx execution, missing expected event");
                    $("#logRemitFrom").html("NA");
                    $("#logRemitHash").html("NA");
                    $("#logRemitValue").html("NA");
                    $("#logRemitTimestamp").html("NA");
                } else {
                    console.log(receipt.logs[0]);
                    $("#remitStatus").html("Transfer executed. Tx ID: " + txId);
                    if (receipt.logs[0].event == "LogRemit"){
                        $("#logRemitFrom").html(receipt.logs[0].args.sender);
                        $("#logRemitHash").html(receipt.logs[0].args.hashCode);
                        $("#logRemitValue").html(receipt.logs[0].args.value.toString(10));
                        $("#logRemitTimestamp").html(receipt.logs[0].args.deadline.toString(10));
                    } else {
                        $("#logRemitFrom").html("NA");
                        $("#logRemitHash").html("NA");
                        $("#logRemitValue").html("NA");
                        $("#logRemitTimestamp").html("NA");
                    }
                }
            }       
        )
    } catch (e){
        let errorString = e.toString();
        if (errorString.includes("invalid address")){
            errorString = "Tx not created. Please check input addresses.";
        }
        $("#remitStatus").html(errorString);
        $("#logRemitFrom").html("NA");
        $("#logRemitHash").html("NA");
        $("#logRemitValue").html("NA");
        $("#logRemitTimestamp").html("NA");
        console.error(e);
    }
};

const balanceCheck = async() => {
    try{
        let amount = bigNum(await web3.eth.getBalance($("select[id='checkBal']").val()));
        $("#balance").html(amount.toString(10));
    } catch (e) {
        $("#balance").html(e.toString());
        console.error(e);
    }
};

const retrieveAction = async() =>{
    // We simulate the real call and see whether this is likely to work.
    try{
        const gas = 300000; 
        let txId;   
        let inputCodeA = ($("input[name='inputCodeA']").val());
        let from = $("select[id='retrieveAddr']").val();
        let deployed = await Remittance.deployed();
        let simResult = await deployed.retrieve.call(
            inputCodeA,
            {
            from: from,
            gas:gas
            });
        
        if (await !simResult) {
            throw new Error("The transaction will fail anyway, not sending");
        }
        // Ok, we move onto the proper action.
        await deployed.retrieve(
            inputCodeA,
            {
            from: from,
            gas:gas
            }
        )
        .on(
            "transactionHash",
            txHash => {
                txId = txHash;
                $("#retrieveStatus").html("Created Transaction: " + txHash);
            }
        )
        .on(
            "receipt", receipt =>{
                if (!receipt.status) {
                    console.error("Wrong status");
                    console.error(receipt);
                    $("#retrieveStatus").html("There was an error in the tx execution, status not 1");
                    $("#logRetrieveFrom").html("NA");
                    $("#logRetrieveHash").html("NA");
                    $("#logRetrieveValue").html("NA");
                    $("#logRetrieveTimestamp").html("NA");
                } else if (receipt.logs.length == 0) {
                    console.error("Empty logs");
                    console.error(receipt);
                    $("#retrieveStatus").html("There was an error in the tx execution, missing expected event");
                    $("#logRetrieveFrom").html("NA");
                    $("#logRetrieveHash").html("NA");
                    $("#logRetrieveValue").html("NA");
                    $("#logRetrieveTimestamp").html("NA");
                } else {
                    console.log(receipt.logs[0]);
                    $("#retrieveStatus").html("retrieve executed. Tx ID: " + txId);
                    if (receipt.logs[0].event == "LogRetrieve"){
                        $("#logRetrieveFrom").html(receipt.logs[0].args.retriever);
                        $("#logRetrieveHash").html(receipt.logs[0].args.hashCode);
                        $("#logRetrieveValue").html(receipt.logs[0].args.value.toString(10));
                        $("#logRetrieveTimestamp").html(receipt.logs[0].args.timestamp.toString(10));
                    } else {
                        $("#logRetrieveFrom").html("NA");
                        $("#logRetrieveHash").html("NA");
                        $("#logRetrieveValue").html("NA");
                        $("#logRetrieveTimestamp").html("NA");
                    }
                }
            }       
        )
    }catch (e){
        let errorString = e.toString();
        if (errorString.includes("invalid address")){
            errorString = "Tx not created. Please check input address.";
        }
        $("#retrieveStatus").html(errorString);
        $("#logRetrieveFrom").html("NA");
        $("#logRetrieveHash").html("NA");
        $("#logRetrieveValue").html("NA");
        $("#logRetrieveTimestamp").html("NA");

        console.error(e);
    }
};

const cancelAction = async() =>{
    // We simulate the real call and see whether this is likely to work.
    try{
        const gas = 300000; 
        let txId;   
        let cancelHash = ($("input[name='cancelHash']").val());
        let from = $("select[id='cancelAddr']").val();
        let deployed = await Remittance.deployed();
        let simResult = await deployed.cancel.call(
            cancelHash,
            {
            from: from,
            gas:gas
            });
        
        if (await !simResult) {
            throw new Error("The transaction will fail anyway, not sending");
        }
        // Ok, we move onto the proper action.
        await deployed.cancel(
            cancelHash,
            {
            from: from,
            gas:gas
            }
        )
        .on(
            "transactionHash",
            txHash => {
                txId = txHash;
                $("#retrieveStatus").html("Created Transaction: " + txHash);
            }
        )
        .on(
            "receipt", receipt =>{
                if (!receipt.status) {
                    console.error("Wrong status");
                    console.error(receipt);
                    $("#cancelStatus").html("There was an error in the tx execution, status not 1");
                    $("#logCancelFrom").html("NA");
                    $("#logCancelHash").html("NA");
                    $("#logCancelValue").html("NA");
                    $("#logCancelTimestamp").html("NA");
                } else if (receipt.logs.length == 0) {
                    console.error("Empty logs");
                    console.error(receipt);
                    $("#cancelStatus").html("There was an error in the tx execution, missing expected event");
                    $("#logCancelFrom").html("NA");
                    $("#logCancelHash").html("NA");
                    $("#logCancelValue").html("NA");
                    $("#logCancelTimestamp").html("NA");
                } else {
                    console.log(receipt.logs[0]);
                    $("#cancelStatus").html("Cancel executed. Tx ID: " + txId);
                    if (receipt.logs[0].event == "LogCancel"){
                        $("#logCancelFrom").html(receipt.logs[0].args.sender);
                        $("#logCancelHash").html(receipt.logs[0].args.hashCode);
                        $("#logCancelValue").html(receipt.logs[0].args.value.toString(10));
                        $("#logCancelTimestamp").html(receipt.logs[0].args.timestamp.toString(10));
                    } else {
                        $("#logCancelFrom").html("NA");
                        $("#logCancelHash").html("NA");
                        $("#logCancelValue").html("NA");
                        $("#logCancelTimestamp").html("NA");
                    }
                }
            }       
        )
    }catch (e){
        let errorString = e.toString();
        if (errorString.includes("invalid address")){
            errorString = "Tx not created. Please check input address.";
        }
        $("#cancelStatus").html(errorString);
        $("#logCancelFrom").html("NA");
        $("#logCancelHash").html("NA");
        $("#logCancelValue").html("NA");
        $("#logCancelTimestamp").html("NA");

        console.error(e);
    }
};


window.addEventListener('load', async() => {
    let accountsList;
    
    accountsList = await web3.eth.getAccounts()            
    if (accountsList.length == 0) {
        throw new Error("No account with which to transact");
    }
    let network = await web3.eth.net.getId();
    console.log("Network:", network.toString(10));
    await Remittance.deployed();
    await Promise.all([
        populator("remitAddr", accountsList),
        populator("remitToAddr",accountsList),
        populator("retrieveAddr", accountsList),
        populator("cancelAddr", accountsList),
        populator("checkBal",accountsList),

        $("#GenCode").click(codeGenAction),
        $("#Remit").click(remitAction),
        $("#Check").click(balanceCheck),
        $("#Retrieve").click(retrieveAction),
        $("#Cancel").click(cancelAction)
    ]).catch(console.error);
});

let populator = function(elId, list){
    let selector = this.document.getElementById(elId);

    for(let i = 0; i < list.length; i++) {
        let el = document.createElement("option");
        el.textContent = list[i];
        el.value = list[i];
        selector.appendChild(el);
    }
}


require("file-loader?name=../index.html!../index.html");
