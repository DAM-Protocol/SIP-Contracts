// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.10;

import { IPoolLogic, IPoolManagerLogic } from "../dHedge-Factory-Version/Interfaces/IdHedge.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "hardhat/console.sol";

contract MockdHEDGEPool is ERC20, IPoolLogic, IPoolManagerLogic {
    uint8 private _decimals;

    address[] private depositAssets;
    mapping(address => bool) private depositAssetStatus;
    mapping(address => uint256) private remainingCooldown;

    constructor(
        string memory name,
        string memory symbol,
        uint8 initDecimals
    ) ERC20(name, symbol) {
        _decimals = initDecimals;
    }

    /**
     * @dev See {ERC20-_mint}.
     */
    function mint(address account, uint256 amount) public returns (bool) {
        ERC20._mint(account, amount);
        return true;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 newDecimals) public {
        _decimals = newDecimals;
    }

    function deposit(address _asset, uint256 _amount)
        external
        returns (uint256 _liquidityMinted)
    {
        uint8 tokenDecimals = ERC20(_asset).decimals();

        if (tokenDecimals <= 18) {
            _liquidityMinted = _amount * (10**(18 - tokenDecimals));
        } else {
            _liquidityMinted = _amount / (10**(18 - tokenDecimals));
        }

        remainingCooldown[msg.sender] = block.timestamp + 24 hours;

        ERC20._mint(msg.sender, _liquidityMinted);

        console.log("Total DHPT from poolLogic: %s", balanceOf(msg.sender));

        ERC20(_asset).transferFrom(msg.sender, address(this), _amount);
    }

    function getExitRemainingCooldown(address _sender)
        public
        view
        returns (uint256)
    {
        if (remainingCooldown[_sender] > block.timestamp)
            return remainingCooldown[_sender] - block.timestamp;

        return 0;
    }

    function poolManagerLogic() public view returns (address) {
        return address(this);
    }

    function setIsDepositAsset(address _asset, bool _isDepositAsset) public {
        depositAssetStatus[_asset] = _isDepositAsset;
    }

    function isDepositAsset(address _asset) public view returns (bool) {
        return depositAssetStatus[_asset];
    }

    function setDepositAssets(address[] memory _assets) public {
        depositAssets = _assets;
    }

    function getDepositAssets() public view returns (address[] memory _assets) {
        return depositAssets;
    }
}
