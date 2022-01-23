// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

interface IdHedgeCore {
    function dHedgeDeposit(address _depositToken) external;

    function checkPoolActive() external view returns (bool);

    function requireUpkeep() external view returns (bool, address);
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
    event CorePaused(address _dHedgeCore);
    event CoreUnPaused(address _dHedgeCore);
    event DepositSuccess(address _dHedgeCore, address _depositToken);
    event DepositFailed(address _dHedgeCore, address _depositToken, bytes _err);

    function performUpkeep(address _contract, address _depositToken) external;

    function checkUpkeep(address _contract)
        external
        view
        returns (bool _canExec, bytes memory _execPayload);
}
