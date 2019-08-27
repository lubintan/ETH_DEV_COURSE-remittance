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
	uint256 public constant maxDeadline = 172800; // 2 days
	uint256 public constant fee = 0.03 ether; // flat fee
	address owner;


	event LogRemit(address indexed sender, bytes32 indexed hashCode, uint256 indexed value, uint256 deadline);
	event LogRetrieve(address indexed retriever, bytes32 indexed hashCode, uint256 indexed value, uint256 timestamp);
	event LogCancel(address indexed sender, bytes32 indexed hashCode, uint256 indexed value, uint256 timestamp);
	event LogGetFeePot(address indexed account, uint256 indexed value);
	event LogTransferOwnership(address indexed oldOwner, address indexed newOwner);
	event LogKilledWithdrawal(address indexed account, uint256 indexed value);


	using SafeMath for uint256;
	//add, sub, mul, div, mod

    constructor()
    public
    {
		owner = msg.sender;
	}

	modifier onlyOwner()
	{
		require (msg.sender == owner);
		_;
	}

    function remit(bytes32 hashed, uint256 deadline)
        public
		payable
		whenAlive
		whenNotPaused
        returns (bool)
    {
		require(msg.value > fee, "Below minimum remittance amount.");
		require(deadline <= maxDeadline, "Deadline exceeds maximum allowed.");
		require(remittances[hashed].deadline == 0, "Hash has been used before.");
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
		uint256 value = remitted.value;
		require(value > 0, 'Nothing to cancel.');
		require(now > remitted.deadline, 'Remittance still live. Cannot cancel.');
		require(msg.sender == remitted.sender, 'Can only be cancelled by original sender.');

		remitted.value = 0;
		remitted.sender = address(0);
		remittances[hashed] = remitted;

		emit LogCancel(msg.sender, hashed, value, now);
		msg.sender.transfer(value);
	}

	function getFeePot()
		public
		whenAlive
	{
		uint256 value = feePot[msg.sender];
		require(value > 0, 'Cannot withdraw 0 value.');

		feePot[msg.sender] = 0;

		emit LogGetFeePot(msg.sender, value);
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
		whenPaused
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

	function killedWithdrawal()
		public
		whenKilled
		onlyOwner
	{
		uint256 contractBalance = address(this).balance;
		address payable withdrawer = msg.sender;

		require(contractBalance > 0, "Contract balance is 0.");
		emit LogKilledWithdrawal(withdrawer, contractBalance);
		withdrawer.transfer(contractBalance);
	}

	function ()
		external
	{
		revert("Reverting fallback.");
	}

}
