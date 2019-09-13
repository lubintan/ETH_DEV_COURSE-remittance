// const ConvertLib = artifacts.require("ConvertLib");
const Remittance = artifacts.require("Remittance");

module.exports = function(deployer) {
  // deployer.deploy(ConvertLib);
  // deployer.link(ConvertLib, MetaCoin);
  deployer.deploy(Remittance);
};
