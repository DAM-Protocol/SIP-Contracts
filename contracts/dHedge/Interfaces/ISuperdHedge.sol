// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

interface IdHedgeCore {
    function dHedgeDeposit() external;

    function checkPoolActive() external view returns (bool);

    function requireUpkeep() external view returns (bool);
}

interface IdHedgeBank {
    function deposit(address _poolToken, uint256 _amount) external;

    function withdraw(
        address _poolToken,
        address _user,
        uint256 _amount
    ) external;
}

interface IdHedgeUpkeep {
    event CoreAdded(address _dHedgeCore, uint256 _timestamp);
    event CoreRemoved(address _dHedgeCore, uint256 _timestamp);
    event DepositCalled(address _dHedgeCore, uint256 _timestamp);

    function callFunction(address _contract) external;

    function checker()
        external
        view
        returns (bool _canExec, bytes memory _execPayload);
}
