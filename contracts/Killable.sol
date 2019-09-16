pragma solidity 0.5.10;

import './local/SafeMath.sol';
import './local/Pausable.sol';

//version: openzeppelin-solidity@2.3.0
//functions: isPauser(address), addPauser(address), renouncePauser(), pause(), unpause(), paused()

contract Killable is Pausable{

	bool private killed;
    event LogKilled(address account);

	constructor ()
	public
	{
		killed = false;
    }

	function kill()
		public
		onlyPauser
		whenPaused
	{
		killed = true;
		emit LogKilled(msg.sender);
	}

	modifier whenAlive()
	{
		require(!killed, "Killable: killed");
		_;
	}

	modifier whenKilled()
	{
		require(killed, "Killable: not killed");
		_;
	}
}