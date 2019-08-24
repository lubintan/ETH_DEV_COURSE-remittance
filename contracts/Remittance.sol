pragma solidity 0.5.10;

import './Killable.sol';

//version: openzeppelin-solidity@2.3.0
//functions: isPauser(address), addPauser(address), renouncePauser(), pause(), unpause(), paused()

contract Remittance is Killable{

	struct Entry
    {
        uint256 value;
        uint timestamp;
		uint32 deadline;
		address remitter;
    }

    mapping (bytes32 => Entry) remittedMap;
	uint32 maxDeadline = 172800; // 2days;

	event LogRemit(address indexed remitter, bytes32 indexed hashCode, uint256 indexed value, uint timestamp, uint32 deadline);
	event LogRetrieve(address indexed retriever, bytes32 indexed hashCode, uint256 indexed value, uint timestamp);
	event LogKilledWithdrawal(address indexed account, uint256 indexed value);

	using SafeMath for uint256;
	//add, sub, mul, div, mod

    constructor()
    public
    {}

    function remit(bytes32 hashed, uint32 deadline)
        public
		payable
		whenNotKilled
		whenNotPaused
        returns (bool)
    {
        require(msg.value > 0, "Cannot remit 0.");
		require(remittedMap[hashed].value == 0, "Cannot overwrite unretreived value.");
		require(deadline <= maxDeadline, "Deadline exceeds maximum allowed.");
        Entry memory remitted;
		remitted.value = msg.value;
		remitted.timestamp = now;
		remitted.deadline = deadline;
		remitted.remitter = msg.sender;
		remittedMap[hashed] = remitted;

        emit LogRemit(msg.sender, hashed, msg.value, now, deadline);
        return true;
    }

    function retrieve(string memory codeA, string memory codeB)
        public
		whenNotKilled
		whenNotPaused
    {
        bytes32 hashed = hashIt(codeA, codeB);
        Entry memory remitted = remittedMap[hashed];
		uint256 value = remitted.value;
        require(value > 0, "Nothing to retrieve.");
		require((now <= (remitted.timestamp + remitted.deadline)
					|| (remitted.remitter == msg.sender)),
						"Code expired. Only remitter can retrieve.");

		remitted.value = 0;
		remittedMap[hashed] = remitted;

		emit LogRetrieve(msg.sender, hashed, value, now);
		msg.sender.transfer(value);
    }

	function hashIt(string memory codeA, string memory codeB)
		public
		pure
		returns (bytes32)
	{
		return keccak256(abi.encodePacked(codeA, codeB));
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
