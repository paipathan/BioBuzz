package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.algorithm.Algorithm;
import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.localization.Localizer;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

import dev.nextftc.hardware.actuators.NextMotor;

public class Constants {
    public static com.pedropathing.drivetrain.Drivetrain drivetrain(HardwareMap h) {
        return new Mecanum(h, Drivetrain.mecanumConfig);
    }

    public static Localizer localizer(HardwareMap h) {
        return new PinpointLocalizer(h, Drivetrain.pinpointConfig);
    }

    public static Algorithm algorithm() {
        return new Foresight(Drivetrain.foresightConfig);
    }

    public static Follower create(HardwareMap h) {
        return new Follower(localizer(h), drivetrain(h), algorithm());
    }

    public static class Drivetrain {
        public static final Pose startPose = new Pose(0, 0, 0);
        public static final Pose resetPose = new Pose(9, 9, Math.toRadians(90));

        public static final double slowSpeed = 0.4;

        public static final MecanumConfig mecanumConfig = new MecanumConfig(c -> {
            c.frontLeftName.set("fl");
            c.frontRightName.set("fr");
            c.backLeftName.set("bl");
            c.backRightName.set("br");
            c.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
            c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
        });

        public static final PinpointConfig pinpointConfig = new PinpointConfig(c -> {
            c.name.set("pinpoint");
            c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
            c.xPodOffset.set(3.489964702936608);
            c.yPodOffset.set(-4.930589931217705);
            c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
            c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
            c.globalDistanceUnit.set(DistanceUnit.INCH);
            c.offsetUnits.set(DistanceUnit.INCH);
        });

        public static final ForesightConfig foresightConfig = new ForesightConfig(c -> {
            Controller primaryTranslationalForward = Controller.proportional(0.31695896638586846);
            Controller secondaryTranslationalForward = Controller.proportional(0.11710786878001524);
            Controller primaryTranslationalLateral = Controller.proportional(0.49270594302169024);
            Controller secondaryTranslationalLateral = Controller.proportional(0.1820416806012474);

            c.forwardTranslational.set(Controller.piecewise(secondaryTranslationalForward).put(2.5, primaryTranslationalForward));
            c.strafeTranslational.set(Controller.piecewise(secondaryTranslationalLateral).put(2.5, primaryTranslationalLateral));

            c.coast.set(Controller.proportionalFeedforward(0.012707253306560775));
            c.brake.set(Controller.proportionalFeedforward(0.010801165310576658));

            c.headingFeedback.set(Controller.proportional(6.100494962820854));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(0.050830117376764294, 0.008351748206249005));

            c.linearBrakeCoefficients.set(Matrix.diag(0.05668663619191991, 0.06990910975077083));
            c.quadraticBrakeCoefficients.set(Matrix.diag(0.001929587469976467, 0.0013264711238913005));

            c.maxAchievableForwardVelocity.set(76.20941420165023);
            c.maxAchievableStrafeVelocity.set(62.07150168356044);
            c.naturalForwardDeceleration.set(41.12426767940491);
            c.naturalStrafeDeceleration.set(64.63576436632204);
        });
    }

    public static class Intake {
        public static final String intakeMotorName = "intake";
    }

    public static class Turret {
        public static final int turretServoPort1 = 1;
        public static final int turretServoPort2 = 2;
        public static final NextMotor.Direction turretServoDirection1 = NextMotor.Direction.FORWARD;
        public static final NextMotor.Direction turretServoDirection2 = NextMotor.Direction.FORWARD;
        public static final double servoCacheTolerance = 0.001;

        public static final double rangeDegrees = 355;
        public static final Pose turretOffset = new Pose(0, 0);
    }

    public static class ShotCalculator {
        public static final Pose blueGoal = new Pose(84, 54);
        public static final Pose redGoal = new Pose(84, 54);
    }
}
