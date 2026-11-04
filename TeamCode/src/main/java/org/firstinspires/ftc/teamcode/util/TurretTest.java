package org.firstinspires.ftc.teamcode.util;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;

@TeleOp(name = "Turret Test")
public class TurretTest extends LinearOpMode {
    @Override
    public void runOpMode() {
        NextServo turretServo1 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort1, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection1);
        NextServo turretServo2 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort2, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection2);

        double position = 0.5;
        turretServo1.setPosition(position);
        turretServo2.setPosition(position);

        waitForStart();

        while (opModeIsActive()) {
            if (gamepad1.y) position = 0.5;
            else if (gamepad1.x) position = 0;
            else if (gamepad1.b) position = 1;

            turretServo1.setPosition(position);
            turretServo2.setPosition(position);

            telemetry.addData("Turret position", position);
            telemetry.update();
        }
    }
}
