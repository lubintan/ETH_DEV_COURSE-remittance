pragma solidity 0.5.10;

import './Killable.sol';

//version: openzeppelin-solidity@2.3.0
//functions: isPauser(address), addPauser(address), renouncePauser(), pause(), unpause(), paused()
// est deployment cost: 38718760000000000 wei

contract Remittance is Killable{

    struct Entry
    {
        uint256 value;
        uint256 deadline;
        address sender;
    }

    mapping (bytes32 => Entry) remittances;
    mapping (address => uint256) feePot;
    uint256 public constant maxDeadline = 2 days; // 172800 seconds
    uint256 public fee;
    address owner;


    event LogRemit(address indexed sender, bytes32 indexed hashCode, uint256 value, uint256 deadline);
    event LogRetrieve(address indexed retriever, bytes32 indexed hashCode, uint256 value, uint256 timestamp);
    event LogCancel(address indexed sender, bytes32 indexed hashCode, uint256 value, uint256 timestamp);
    event LogWithdrawFeePot(address indexed account, uint256 value);
    event LogTransferOwnership(address indexed oldOwner, address indexed newOwner);
    event LogSetFee(address indexed account, uint256 newFee);
    event LogKilledWithdrawal(address indexed account, uint256 value);


    using SafeMath for uint256;
    //add, sub, mul, div, mod

    constructor()
    public
    {
        owner = msg.sender;
        fee = 0.003 ether;
    }

    modifier onlyOwner()
    {
        require (msg.sender == owner);
        _;
    }

    function remit(bytes32 hashed, uint256 deadline, uint256 feeLimit)
        public
        payable
        whenAlive
        whenNotPaused
        returns (bool)
    {
        require(msg.value > fee, "Below minimum remittance amount.");
        require(deadline <= maxDeadline, "Deadline exceeds maximum allowed.");
        require(remittances[hashed].deadline == 0, "Hash has been used before.");
        require(feeLimit >= fee, "Current fee exceeds expected fee.");

        Entry memory remitted;
        remitted.value = msg.value.sub(fee);
        feePot[owner] = feePot[owner].add(fee);
        remitted.deadline = deadline.add(now);
        remitted.sender = msg.sender;
        remittances[hashed] = remitted;

        emit LogRemit(msg.sender, hashed, msg.value, remitted.deadline);
        return true;
    }

    function retrieve(bytes32 codeA)
        public
        whenAlive
        whenNotPaused
    {
        bytes32 hashed = hashIt(codeA, msg.sender);
        uint256 value = remittances[hashed].value;
        require(value > 0, "Nothing to retrieve.");

        remittances[hashed].value = 0;
        remittances[hashed].sender = address(0);

        emit LogRetrieve(msg.sender, hashed, value, now);
        msg.sender.transfer(value);
    }

    function cancel(bytes32 hashed)
        public
        whenAlive
        whenNotPaused
    {
        Entry memory remitted = remittances[hashed];
        require(remitted.value > 0, 'Nothing to cancel.');
        require(now > remitted.deadline, 'Remittance still live. Cannot cancel.');
        require(msg.sender == remitted.sender, 'Can only be cancelled by original sender.');

        remittances[hashed].value = 0;
        remittances[hashed].sender = address(0);

        emit LogCancel(msg.sender, hashed, remitted.value, now);
        msg.sender.transfer(remitted.value);
    }

    function withdrawFeePot()
        public
        whenAlive
    {
        uint256 value = feePot[msg.sender];
        require(value > 0, 'Cannot withdraw 0 value.');

        feePot[msg.sender] = 0;

        emit LogWithdrawFeePot(msg.sender, value);
        msg.sender.transfer(value);
    }

    function hashIt(bytes32 codeA, address codeB)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(codeA, codeB, address(this)));
    }

    function transferOwnership(address newOwner)
        public
        whenAlive
        onlyOwner
    {
        require (newOwner != address(0), 'New owner cannot be non-existent.');

        if (!isPauser(newOwner)){
            addPauser(newOwner);
        }

        emit LogTransferOwnership(owner, newOwner);
        owner = newOwner;
    }

    function setFee(uint newFee)
        public
        whenAlive
        onlyOwner
    {
        require(fee != newFee, 'Fee is already at desired value.');
        fee = newFee;
        emit LogSetFee(msg.sender, newFee);
    }


    function killedWithdrawal()
        public
        whenKilled
        onlyOwner
    {
        uint256 contractBalance = address(this).balance;
        require(contractBalance > 0, "Contract balance is 0.");
        emit LogKilledWithdrawal(msg.sender, contractBalance);
        msg.sender.transfer(contractBalance);
    }

    function ()
        external
    {
        revert("Reverting fallback.");
    }

}
