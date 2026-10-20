package org.firstinspires.ftc.teamcode.teleop;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;

import dev.nextftc.robot.opmode.NextTeleop;

@NextTeleop(name = "Red Teleop")
public class Red extends NextTele {
    public Red(Robot robot) {
        super(robot, Alliance.RED);
    }
}
