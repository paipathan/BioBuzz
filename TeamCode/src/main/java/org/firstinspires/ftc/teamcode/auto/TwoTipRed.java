package org.firstinspires.ftc.teamcode.auto;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;

import dev.nextftc.robot.opmode.NextAutonomous;

@NextAutonomous(name = "Two Tip Red", preselectTeleop = "Red Teleop")
public class TwoTipRed extends TwoTip {
    public TwoTipRed(Robot robot) {
        super(robot, Alliance.RED);
    }
}
