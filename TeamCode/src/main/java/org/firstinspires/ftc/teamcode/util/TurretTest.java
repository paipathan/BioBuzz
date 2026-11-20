package org.firstinspires.ftc.teamcode.util;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.teamcode.subsystems.Turret;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;

/**
 * Dpad left/right: turret +/-10 deg (left = CCW), stops at the +/-180 software limit.
 * Y: center. X / B: raw servo 0 / 1 (ignores the limit).
 */
@TeleOp(name = "Turret Test")
public class TurretTest extends LinearOpMode {
    private static final double STEP_DEGREES = 10;

    @Override
    public void runOpMode() {
        NextServo turretServo1 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort1, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection1);
        NextServo turretServo2 = new NextServo(RobotController.controlHub(), Constants.Turret.turretServoPort2, Constants.Turret.servoCacheTolerance, Constants.Turret.turretServoDirection2);

        double angleDegrees = 0;
        double position = Turret.toPosition(0);
        boolean rawMode = false;
        boolean lastLeft = false, lastRight = false;

        turretServo1.setPosition(position);
        turretServo2.setPosition(position);

        waitForStart();

        while (opModeIsActive()) {
            boolean left = gamepad1.dpad_left, right = gamepad1.dpad_right;
            double limit = Constants.Turret.limitDegrees;
            if (left && !lastLeft) {
                angleDegrees = Math.min(limit, angleDegrees + STEP_DEGREES);
                rawMode = false;
            }
            if (right && !lastRight) {
                angleDegrees = Math.max(-limit, angleDegrees - STEP_DEGREES);
                rawMode = false;
            }
            lastLeft = left;
            lastRight = right;

            if (gamepad1.y) {
                angleDegrees = 0;
                rawMode = false;
            } else if (gamepad1.x) {
                position = 0;
                rawMode = true;
            } else if (gamepad1.b) {
                position = 1;
                rawMode = true;
            }

            if (!rawMode) position = Turret.toPosition(Math.toRadians(angleDegrees));
            turretServo1.setPosition(position);
            turretServo2.setPosition(position);

            telemetry.addData("Turret angle (deg)", rawMode ? "raw" : String.valueOf(angleDegrees));
            telemetry.addData("Turret position", position);
            telemetry.addLine("Dpad L/R: +/-10 deg | Y: center | X/B: raw 0/1");
            telemetry.update();
        }
    }
}
