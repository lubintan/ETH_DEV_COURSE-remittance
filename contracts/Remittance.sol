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
	uint256 maxDeadline = 172800; // 2days;


	event LogRemit(address indexed sender, bytes32 indexed hashCode, uint256 indexed value, uint256 deadline);
	event LogRetrieve(address indexed retriever, bytes32 indexed hashCode, uint256 indexed value, uint256 timestamp);
	event LogCancel(address indexed sender, bytes32 indexed hashCode, uint256 indexed value, uint256 timestamp);
	event LogKilledWithdrawal(address indexed account, uint256 indexed value);

	using SafeMath for uint256;
	//add, sub, mul, div, mod

    constructor()
    public
    {}

    function remit(bytes32 hashed, uint256 deadline)
        public
		payable
		whenAlive
		whenNotPaused
        returns (bool)
    {
		require(msg.value > 0, "Cannot remit 0.");
		require(deadline <= maxDeadline, "Deadline exceeds maximum allowed.");
		require(remittances[hashed].deadline == 0, "Hash has been used before.");
        Entry memory remitted;
		remitted.value = msg.value;
		remitted.deadline = deadline.add(now);
		remitted.sender = msg.sender;
		remittances[hashed] = remitted;

        emit LogRemit(msg.sender, hashed, msg.value, remitted.deadline);
        return true;
    }

    function retrieve(string memory codeA)
        public
		whenAlive
		whenNotPaused
    {
        bytes32 hashed = hashIt(codeA, msg.sender);
        Entry memory remitted = remittances[hashed];
		uint256 value = remitted.value;
        require(value > 0, "Nothing to retrieve.");
		require(now <= remitted.deadline, 'Remittance expired. Sender needs to cancel remittance.');

		remitted.value = 0;
		remittances[hashed] = remitted;

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
		remittances[hashed] = remitted;

		emit LogCancel(msg.sender, hashed, value, now);
		msg.sender.transfer(value);
	}

	function hashIt(string memory codeA, address codeB)
		public
		view
		returns (bytes32)
	{
		return keccak256(abi.encodePacked(codeA, codeB, address(this)));
	}

	function killedWithdrawal()
		public
		onlyPauser
		whenKilled
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
