const bigNum = web3.utils.toBN;

const Remittance = artifacts.require("Remittance");
const initialFee = bigNum(web3.utils.toWei('0.01'));

module.exports = function(deployer) {
  deployer.deploy(Remittance, initialFee);
};
